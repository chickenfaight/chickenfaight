package model

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// OpenAI talks to an OpenAI-compatible server (local Ollama for now):
// POST {BaseURL}/chat/completions with stream: true, reading SSE
// choices[0].delta.content. Only Info and Warm use Ollama's own API.
type OpenAI struct {
	BaseURL string // e.g. http://127.0.0.1:11434/v1
	Name    string
	HTTP    *http.Client // nil means http.DefaultClient; contexts bound every call
}

const maxLine = 1 << 20

func (c *OpenAI) Info(ctx context.Context) (ModelInfo, error) {
	info := ModelInfo{Name: c.Name, Metadata: map[string]any{}}
	var show struct {
		Details struct {
			ParameterSize     string `json:"parameter_size"`
			QuantizationLevel string `json:"quantization_level"`
			Family            string `json:"family"`
		} `json:"details"`
		ModelInfo map[string]any `json:"model_info"`
		Error     string         `json:"error"`
	}
	status, err := c.postJSON(ctx, c.ollamaURL("/api/show"), map[string]string{"model": c.Name}, &show)
	if err != nil {
		return ModelInfo{}, err
	}
	if status == http.StatusNotFound && show.Error != "" {
		return ModelInfo{}, fmt.Errorf("%w: model %q isn't installed; run `ollama pull %s`", ErrBadResponse, c.Name, c.Name)
	}
	if status != http.StatusOK {
		// Not Ollama, or an older one: play without size details (the server treats that as large).
		return info, nil
	}
	for key, value := range map[string]string{
		"parameter_size":     show.Details.ParameterSize,
		"quantization_level": show.Details.QuantizationLevel,
		"family":             show.Details.Family,
	} {
		if value != "" {
			info.Metadata[key] = value
		}
	}
	for key, value := range show.ModelInfo {
		if n, ok := value.(float64); ok && strings.HasSuffix(key, ".context_length") && n > 0 {
			length := int(n)
			info.ContextLength = &length
		}
	}
	return info, nil
}

// Warm asks Ollama to load the model, so the first turn doesn't wait for it.
func (c *OpenAI) Warm(ctx context.Context) error {
	status, err := c.postJSON(ctx, c.ollamaURL("/api/generate"), map[string]string{"model": c.Name, "keep_alive": "10m"}, nil)
	if err == nil && status != http.StatusOK {
		err = fmt.Errorf("%w: HTTP %d", ErrBadResponse, status)
	}
	return err
}

func (c *OpenAI) Stream(ctx context.Context, req TurnRequest) (<-chan Chunk, error) {
	body, err := json.Marshal(map[string]any{
		"model":      c.Name,
		"messages":   req.Messages,
		"max_tokens": req.MaxTokens,
		"stream":     true,
	})
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(c.BaseURL, "/")+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	resp, err := c.client().Do(httpReq)
	if err != nil {
		return nil, unreachable(ctx, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		defer resp.Body.Close()
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("%w: HTTP %d: %s", ErrBadResponse, resp.StatusCode, strings.TrimSpace(string(detail)))
	}
	chunks := make(chan Chunk)
	go func() {
		defer close(chunks)
		defer resp.Body.Close()
		if err := readStream(ctx, resp.Body, chunks); err != nil && ctx.Err() == nil {
			send(ctx, chunks, Chunk{Err: err})
		}
	}()
	return chunks, nil
}

// readStream forwards SSE deltas, then one terminal Done chunk. It returns an
// error for a malformed or incomplete stream; on cancellation it just stops.
func readStream(ctx context.Context, body io.Reader, chunks chan<- Chunk) error {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 64<<10), maxLine)
	var finish *string
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		data, ok := strings.CutPrefix(line, "data:")
		if !ok {
			continue // blank separators, comments, and other SSE fields
		}
		data = strings.TrimSpace(data)
		if data == "[DONE]" {
			send(ctx, chunks, Chunk{Done: true, FinishReason: finish})
			return nil
		}
		var event struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			return fmt.Errorf("%w: malformed stream event", ErrBadResponse)
		}
		if event.Error != nil {
			return fmt.Errorf("%w: %s", ErrBadResponse, event.Error.Message)
		}
		if len(event.Choices) == 0 {
			continue
		}
		choice := event.Choices[0]
		if choice.FinishReason != nil {
			finish = choice.FinishReason
		}
		// Reasoning fields are never forwarded; only the visible content is.
		if choice.Delta.Content != "" && !send(ctx, chunks, Chunk{Delta: choice.Delta.Content}) {
			return nil
		}
	}
	if err := scanner.Err(); err != nil {
		if ctx.Err() != nil {
			return nil
		}
		return fmt.Errorf("%w: reading stream: %v", ErrBadResponse, err)
	}
	if finish != nil {
		// Some servers end without [DONE] once a finish reason has arrived.
		send(ctx, chunks, Chunk{Done: true, FinishReason: finish})
		return nil
	}
	return fmt.Errorf("%w: stream ended early", ErrBadResponse)
}

// send delivers a chunk unless the turn was cancelled; false means stop.
func send(ctx context.Context, chunks chan<- Chunk, chunk Chunk) bool {
	select {
	case chunks <- chunk:
		return true
	case <-ctx.Done():
		return false
	}
}

func (c *OpenAI) postJSON(ctx context.Context, url string, in, out any) (int, error) {
	body, err := json.Marshal(in)
	if err != nil {
		return 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.client().Do(req)
	if err != nil {
		return 0, unreachable(ctx, err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxLine))
	if err != nil {
		return 0, fmt.Errorf("%w: %v", ErrBadResponse, err)
	}
	if out != nil {
		_ = json.Unmarshal(data, out) // callers check the status and fields
	}
	return resp.StatusCode, nil
}

// ollamaURL is a path on Ollama's own API: the base URL without its /v1.
func (c *OpenAI) ollamaURL(path string) string {
	return strings.TrimSuffix(strings.TrimRight(c.BaseURL, "/"), "/v1") + path
}

func (c *OpenAI) client() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return http.DefaultClient
}

func unreachable(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return err
	}
	return fmt.Errorf("%w: %v", ErrUnavailable, err)
}
