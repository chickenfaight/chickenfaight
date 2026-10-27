package model

import "context"

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
