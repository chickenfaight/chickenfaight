package model

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// sse serves one scripted chat-completions stream and records the request.
func sse(t *testing.T, status int, lines ...string) (*OpenAI, *map[string]any) {
	t.Helper()
	got := map[string]any{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/chat/completions" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(status)
		for _, line := range lines {
			fmt.Fprintln(w, line)
			w.(http.Flusher).Flush()
		}
	}))
	t.Cleanup(srv.Close)
	return &OpenAI{BaseURL: srv.URL + "/v1", Name: "llama3.2:3b"}, &got
}

func delta(text string) string {
	return fmt.Sprintf(`data: {"choices":[{"delta":{"content":%q},"finish_reason":null}]}`, text)
}

func collect(t *testing.T, chunks <-chan Chunk) (text string, last Chunk) {
	t.Helper()
	for chunk := range chunks {
		text += chunk.Delta
		last = chunk
	}
	return text, last
}

var request = TurnRequest{Messages: []Message{{Role: "system", Content: "Argue pro."}, {Role: "user", Content: "Go"}}, MaxTokens: 400}

func TestStreamsDeltasThenDone(t *testing.T) {
	client, got := sse(t, 200,
		delta("Free "), "",
		`data: {"choices":[{"delta":{"reasoning":"hidden thoughts"}}]}`, "",
		delta("transit!"), "",
		`data: {"choices":[{"delta":{},"finish_reason":"stop"}]}`, "",
		"data: [DONE]")
	chunks, err := client.Stream(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	text, last := collect(t, chunks)
	if text != "Free transit!" || !last.Done || last.FinishReason == nil || *last.FinishReason != "stop" {
		t.Fatalf("text = %q, last = %+v", text, last)
	}
	// The request carries the configured model and the server's messages unchanged.
	if (*got)["model"] != "llama3.2:3b" || (*got)["stream"] != true || (*got)["max_tokens"] != float64(400) {
		t.Fatalf("request = %v", *got)
	}
	messages, _ := json.Marshal((*got)["messages"])
	if string(messages) != `[{"content":"Argue pro.","role":"system"},{"content":"Go","role":"user"}]` {
		t.Fatalf("messages = %s", messages)
	}
}

func TestFinishReasonWithoutDoneIsComplete(t *testing.T) {
	client, _ := sse(t, 200, delta("ok"), `data: {"choices":[{"delta":{},"finish_reason":"length"}]}`)
	chunks, _ := client.Stream(context.Background(), request)
	if _, last := collect(t, chunks); !last.Done || *last.FinishReason != "length" {
		t.Fatalf("last = %+v", last)
	}
}

func TestBadResponses(t *testing.T) {
	for name, lines := range map[string][]string{
		"malformed event": {delta("ok"), "data: {not json"},
		"error event":     {`data: {"error":{"message":"model crashed"}}`},
		"ended early":     {delta("half an argu")},
	} {
		t.Run(name, func(t *testing.T) {
			client, _ := sse(t, 200, lines...)
			chunks, err := client.Stream(context.Background(), request)
			if err != nil {
				t.Fatal(err)
			}
			if _, last := collect(t, chunks); !errors.Is(last.Err, ErrBadResponse) || last.Done {
				t.Fatalf("last = %+v", last)
			}
		})
	}
}

func TestErrorStatusFailsSetup(t *testing.T) {
	client, _ := sse(t, 404, `{"error":"model 'nope' not found"}`)
	if _, err := client.Stream(context.Background(), request); !errors.Is(err, ErrBadResponse) || !strings.Contains(err.Error(), "404") {
		t.Fatalf("err = %v", err)
	}
}

func TestUnreachableServer(t *testing.T) {
	client := &OpenAI{BaseURL: "http://127.0.0.1:1/v1", Name: "m"}
	if _, err := client.Stream(context.Background(), request); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("err = %v", err)
	}
}

func TestCancelWhileTheModelHangs(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, delta("first"))
		w.(http.Flusher).Flush()
		select { // hang until the client gives up
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer srv.Close()
	defer close(release)
	ctx, cancel := context.WithCancel(context.Background())
	chunks, err := (&OpenAI{BaseURL: srv.URL, Name: "m"}).Stream(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if first := <-chunks; first.Delta != "first" {
		t.Fatalf("first = %+v", first)
	}
	cancel()
	select {
	case chunk, open := <-chunks:
		if open && (chunk.Done || chunk.Err != nil) {
			t.Fatalf("cancelled turn reported a result: %+v", chunk)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("stream didn't close after cancellation")
	}
}

func TestCancelWhileNobodyReads(t *testing.T) {
	client, _ := sse(t, 200, delta("a"), delta("b"), delta("c"), "data: [DONE]")
	ctx, cancel := context.WithCancel(context.Background())
	chunks, err := client.Stream(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	cancel() // the sender must not block forever on an abandoned channel
	deadline := time.After(2 * time.Second)
	for {
		select {
		case _, open := <-chunks:
			if !open {
				return
			}
		case <-deadline:
			t.Fatal("stream goroutine leaked")
		}
	}
}

func ollama(t *testing.T, handler http.HandlerFunc) *OpenAI {
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return &OpenAI{BaseURL: srv.URL + "/v1", Name: "llama3.2:3b"}
}

func TestInfoReadsOllamaDetails(t *testing.T) {
	client := ollama(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		json.NewDecoder(r.Body).Decode(&body)
		if r.URL.Path != "/api/show" || body["model"] != "llama3.2:3b" {
			t.Errorf("request %s %v", r.URL.Path, body)
		}
		fmt.Fprint(w, `{"details":{"parameter_size":"3.2B","quantization_level":"Q4_K_M","family":"llama"},
			"model_info":{"general.architecture":"llama","llama.context_length":131072}}`)
	})
	info, err := client.Info(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if info.Name != "llama3.2:3b" || info.ContextLength == nil || *info.ContextLength != 131072 ||
		info.Metadata["parameter_size"] != "3.2B" || info.Metadata["family"] != "llama" {
		t.Fatalf("info = %+v", info)
	}
}

func TestInfoForAMissingModel(t *testing.T) {
	client := ollama(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
		fmt.Fprint(w, `{"error":"model 'llama3.2:3b' not found"}`)
	})
	if _, err := client.Info(context.Background()); err == nil || !strings.Contains(err.Error(), "ollama pull llama3.2:3b") {
		t.Fatalf("err = %v", err)
	}
}

func TestInfoWithoutOllamaHasNoSize(t *testing.T) {
	client := ollama(t, func(w http.ResponseWriter, r *http.Request) { http.NotFound(w, r) })
	info, err := client.Info(context.Background())
	if err != nil || info.Name != "llama3.2:3b" || len(info.Metadata) != 0 {
		t.Fatalf("info = %+v, err = %v", info, err)
	}
}

func TestWarmLoadsTheModel(t *testing.T) {
	var path string
	client := ollama(t, func(w http.ResponseWriter, r *http.Request) { path = r.URL.Path; fmt.Fprint(w, `{"done":true}`) })
	if err := client.Warm(context.Background()); err != nil || path != "/api/generate" {
		t.Fatalf("Warm = %v at %s", err, path)
	}
}
