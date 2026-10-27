// Package protocol mirrors the BILC WebSocket messages in PROTOCOL.md
// ("WebSocket envelope" and "WebSocket — BILC"). Field names match the wire.
package protocol

import "encoding/json"

// Version is the protocol_version BILC speaks.
const Version = 1

// Message types.
const (
	TypeHello         = "HELLO"
	TypeHelloAck      = "HELLO_ACK"
	TypeHeartbeat     = "HEARTBEAT"
	TypeError         = "ERROR"
	TypeDisconnect    = "DISCONNECT"
	TypeMatchAssign   = "MATCH_ASSIGN"
	TypeTurnRequest   = "TURN_REQUEST"
	TypeMatchResponse = "MATCH_RESPONSE"
	TypeMatchEnd      = "MATCH_END"
	TypeForfeit       = "FORFEIT"
)

// Close codes from PROTOCOL.md's error table.
const (
	CloseUnauthenticated  = 4401
	CloseForbidden        = 4403
	CloseHeartbeatTimeout = 4408
	CloseReplaced         = 4409
	CloseOutdated         = 4426
)

// Envelope is every frame, both directions. Payload stays raw so a heartbeat
// can be echoed unchanged.
type Envelope struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type HelloModel struct {
	Name          string         `json:"name"`
	ContextLength *int           `json:"context_length"`
	Metadata      map[string]any `json:"metadata"`
}

type Hello struct {
	ProtocolVersion int        `json:"protocol_version"`
	ClientVersion   string     `json:"client_version"`
	Platform        string     `json:"platform"`
	Model           HelloModel `json:"model"`
}

type HelloAck struct {
	ProtocolVersion    int     `json:"protocol_version"`
	HeartbeatIntervalS float64 `json:"heartbeat_interval_s"`
}

type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	TurnID  string `json:"turn_id,omitempty"`
}

type Disconnect struct {
	Reason string `json:"reason"`
}

type MatchAssign struct {
	MatchID string `json:"match_id"`
	Side    string `json:"side"`
	Topic   string `json:"topic"`
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type TurnRequest struct {
	TurnID    string    `json:"turn_id"`
	MatchID   string    `json:"match_id"`
	Phase     string    `json:"phase"`
	Messages  []Message `json:"messages"`
	MaxTokens int       `json:"max_tokens"`
	Deadline  string    `json:"deadline"`
}

type MatchResponse struct {
	TurnID       string  `json:"turn_id"`
	Delta        string  `json:"delta"`
	Done         bool    `json:"done"`
	FinishReason *string `json:"finish_reason"`
}

type MatchEnd struct {
	MatchID string `json:"match_id"`
	Status  string `json:"status"`
}

type Forfeit struct {
	MatchID string `json:"match_id"`
	Reason  string `json:"reason"`
}

// Error codes BILC sends about the local model (PROTOCOL.md, "Error codes").
const (
	CodeModelUnavailable = "MODEL_UNAVAILABLE"
	CodeModelError       = "MODEL_ERROR"
	CodeModelTimeout     = "MODEL_TIMEOUT"
	CodeBusy             = "BILC_BUSY"
	CodeBadMessage       = "BAD_MESSAGE"
)

// Encode builds a frame from a payload struct.
func Encode(typ string, payload any) ([]byte, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return json.Marshal(Envelope{Type: typ, Payload: raw})
}
