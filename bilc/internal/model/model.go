package model

import (
	"context"
	"errors"
)

// Failures wrap one of these, so callers can tell them apart with errors.Is
// (BILC.md, "Error mapping"). Context errors are kept as they are.
var (
	// ErrUnavailable: the model server couldn't be reached.
	ErrUnavailable = errors.New("model server unreachable")
	// ErrBadResponse: a non-2xx status, or a malformed or incomplete stream.
	ErrBadResponse = errors.New("bad response from model server")
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// TurnRequest only inference inputs
// selected model and URL belong to the client config, not the server's request.
type TurnRequest struct {
	Messages  []Message
	MaxTokens int
}

type ModelInfo struct {
	Name          string
	ContextLength *int // nil means unknown
	Metadata      map[string]any
}

type Chunk struct {
	Delta        string
	Done         bool
	FinishReason *string
	Err          error
}

type Model interface {
	Info(ctx context.Context) (ModelInfo, error)
	Stream(ctx context.Context, req TurnRequest) (<-chan Chunk, error)
}
