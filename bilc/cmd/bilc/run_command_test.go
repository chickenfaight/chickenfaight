package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chickenfaight/chickenfaight/bilc/internal/auth"
	"github.com/chickenfaight/chickenfaight/bilc/internal/config"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// Remap only Ollama's fixed readiness URL inside this subprocess. No user's local
// service, system keychain, or production credentials are read or modified.
type readinessTransport struct {
	target *url.URL
	base   http.RoundTripper
}

func (t readinessTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Host == "127.0.0.1:11434" {
		r = r.Clone(r.Context())
		u := *r.URL
		u.Host, u.Scheme = t.target.Host, t.target.Scheme
		r.URL = &u
	}
	return t.base.RoundTrip(r)
}

func TestRunCommandHelper(t *testing.T) {
	mode := os.Getenv("BILC_RUN_TEST_MODE")
	if mode == "" {
		return
	}
	server := os.Getenv("BILC_RUN_TEST_SERVER")
	target, err := url.Parse(server)
	if err != nil {
		t.Fatal(err)
	}
	http.DefaultTransport = readinessTransport{target, http.DefaultTransport}
	dir := t.TempDir()
	cfg := config.Config{ServerURL: server, BilcID: "device", Model: config.Model{BaseURL: server + "/v1", Name: "test-model"}}
	if err := config.Save(filepath.Join(dir, "config.json"), cfg); err != nil {
		t.Fatal(err)
	}
	store := memStore{"device": "initial-refresh"}
	c := &cli{stdout: os.Stdout, stderr: os.Stderr, configDir: dir, store: store}
	err = c.run([]string{"run"})
	if mode == "revoked" {
		if !errors.Is(err, auth.ErrNotPaired) {
			t.Fatalf("err=%v", err)
		}
		got, _, loadErr := c.loadConfig()
		if loadErr != nil || got.BilcID != "" || len(store) != 0 {
			t.Fatal("revocation did not clear local identity")
		}
	} else if err != nil {
		t.Fatal(err)
	}
}

func TestRunCommandWiresModelSocketRotationAndGracefulShutdown(t *testing.T) {
	for _, mode := range []string{"play", "revoked"} {
		t.Run(mode, func(t *testing.T) {
			var mu sync.Mutex
			var transcript strings.Builder
			finished := make(chan struct{}, 1)
			mux := http.NewServeMux()
			mux.HandleFunc("/api/version", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, `{"version":"test"}`) })
			mux.HandleFunc("/api/show", func(w http.ResponseWriter, r *http.Request) {
				fmt.Fprint(w, `{"details":{"parameter_size":"3B"},"model_info":{}}`)
			})
			mux.HandleFunc("/api/generate", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, `{}`) })
			mux.HandleFunc("/v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
				var body struct {
					Messages []map[string]string `json:"messages"`
				}
				json.NewDecoder(r.Body).Decode(&body)
				if len(body.Messages) != 1 || body.Messages[0]["content"] != "fixed rules" {
					t.Error("messages were changed")
				}
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"local argument\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
			})
			mux.HandleFunc("/v1/bilc/token", func(w http.ResponseWriter, r *http.Request) {
				if mode == "revoked" {
					w.WriteHeader(401)
					fmt.Fprint(w, `{"code":"TOKEN_INVALID","detail":"revoked"}`)
					return
				}
				json.NewEncoder(w).Encode(map[string]any{"access_token": "test-access", "refresh_token": "rotated", "expires_at": time.Now().Add(time.Hour)})
			})
			mux.HandleFunc("/v1/bilc/ws", func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer test-access" {
					t.Error("missing bearer token")
				}
				ws, err := websocket.Accept(w, r, nil)
				if err != nil {
					t.Error(err)
					return
				}
				defer ws.CloseNow()
				ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
				defer cancel()
				var hello map[string]any
				if err := wsjson.Read(ctx, ws, &hello); err != nil {
					t.Error(err)
					return
				}
				if hello["type"] != "HELLO" {
					t.Error("HELLO was not first")
				}
				for _, frame := range []map[string]any{
					{"type": "HELLO_ACK", "payload": map[string]any{"protocol_version": 1, "heartbeat_interval_s": 15}},
					{"type": "MATCH_ASSIGN", "payload": map[string]any{"match_id": "match", "side": "pro", "topic": "T"}},
					{"type": "TURN_REQUEST", "payload": map[string]any{"match_id": "match", "turn_id": "turn", "phase": "opening", "deadline": time.Now().Add(time.Minute), "max_tokens": 200, "messages": []map[string]string{{"role": "system", "content": "fixed rules"}}}},
				} {
					if err := wsjson.Write(ctx, ws, frame); err != nil {
						t.Error(err)
						return
					}
				}
				for {
					var msg struct {
						Type    string `json:"type"`
						Payload struct {
							Delta string `json:"delta"`
							Done  bool   `json:"done"`
						} `json:"payload"`
					}
					if err := wsjson.Read(ctx, ws, &msg); err != nil {
						return
					}
					if msg.Type == "MATCH_RESPONSE" {
						mu.Lock()
						transcript.WriteString(msg.Payload.Delta)
						mu.Unlock()
						if msg.Payload.Done {
							finished <- struct{}{}
						}
					}
				}
			})
			srv := httptest.NewServer(mux)
			defer srv.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestRunCommandHelper$")
			cmd.Env = append(os.Environ(), "BILC_RUN_TEST_MODE="+mode, "BILC_RUN_TEST_SERVER="+srv.URL)
			var out strings.Builder
			cmd.Stdout, cmd.Stderr = &out, &out
			if err := cmd.Start(); err != nil {
				t.Fatal(err)
			}
			if mode == "play" {
				select {
				case <-finished:
					cmd.Process.Signal(os.Interrupt)
				case <-ctx.Done():
					cmd.Process.Kill()
					t.Fatal("turn did not complete")
				}
			}
			if err := cmd.Wait(); err != nil {
				t.Fatalf("process: %v\n%s", err, out.String())
			}
			mu.Lock()
			got := transcript.String()
			mu.Unlock()
			if mode == "play" && got != "local argument" {
				t.Fatalf("output=%q", got)
			}
			if strings.Contains(out.String(), "initial-refresh") || strings.Contains(out.String(), "fixed rules") {
				t.Fatal("logged credentials or prompt")
			}
		})
	}
}
