// Package match is BILC's MatchHandler: it plays one match at a time,
// forwarding each TURN_REQUEST's messages to the local model unchanged and
// streaming the output back as MATCH_RESPONSE. Game rules stay on the server.
package match

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/chickenfaight/chickenfaight/bilc/internal/model"
	"github.com/chickenfaight/chickenfaight/bilc/internal/protocol"
)

// Send queues a frame on the current connection; false means it is gone.
type Send = func(typ string, payload any) bool

// Warmer is a model that can be loaded ahead of its first turn.
type Warmer interface {
	Warm(ctx context.Context) error
}

// Handler handles MATCH_ASSIGN, TURN_REQUEST, MATCH_END, and FORFEIT. It
// never retries a failed turn: the server decides what a failure means.
type Handler struct {
	Model model.Model
	Log   io.Writer // nil discards progress messages

	mu      sync.Mutex
	matchID string // the assigned match, or ""
	turn    *turn  // the turn in progress, or nil
	workers sync.WaitGroup
}

type turn struct {
	id     string
	cancel context.CancelFunc
}

// Handle processes one frame and reports whether it was a match message.
// ctx is the connection's: when the connection ends, so do its turns.
func (h *Handler) Handle(ctx context.Context, env protocol.Envelope, send Send) bool {
	switch env.Type {
	case protocol.TypeMatchAssign:
		var assign protocol.MatchAssign
		if json.Unmarshal(env.Payload, &assign) != nil || assign.MatchID == "" {
			send(protocol.TypeError, protocol.Error{Code: protocol.CodeBadMessage, Message: "Invalid MATCH_ASSIGN"})
			return true
		}
		h.assign(ctx, assign, send)
	case protocol.TypeTurnRequest:
		var request protocol.TurnRequest
		if json.Unmarshal(env.Payload, &request) != nil || request.TurnID == "" || request.MatchID == "" {
			send(protocol.TypeError, protocol.Error{Code: protocol.CodeBadMessage, Message: "Invalid TURN_REQUEST"})
			return true
		}
		h.startTurn(ctx, request, send)
	case protocol.TypeMatchEnd:
		var end protocol.MatchEnd
		_ = json.Unmarshal(env.Payload, &end)
		if h.finish(end.MatchID) {
			h.logf("Match finished: %s.\n", end.Status)
		}
	case protocol.TypeForfeit:
		var forfeit protocol.Forfeit
		_ = json.Unmarshal(env.Payload, &forfeit)
		// MATCH_END follows and frees the device; until then, stop any turn.
		h.mu.Lock()
		if forfeit.MatchID == h.matchID {
			h.stopTurn()
		}
		h.mu.Unlock()
		h.logf("Your model forfeited the match (%s).\n", forfeit.Reason)
	default:
		return false
	}
	return true
}

// Disconnected stops the turn in progress; the server re-sends MATCH_ASSIGN
// if the device reconnects while the match is still on.
func (h *Handler) Disconnected() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.stopTurn()
}

// Wait returns once every turn worker has exited.
func (h *Handler) Wait() {
	h.workers.Wait()
}

func (h *Handler) assign(ctx context.Context, assign protocol.MatchAssign, send Send) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.matchID != "" && h.matchID != assign.MatchID {
		send(protocol.TypeError, protocol.Error{Code: protocol.CodeBusy, Message: "Already playing another match"})
		return
	}
	if h.matchID == assign.MatchID {
		return // re-sent after a reconnect
	}
	h.matchID = assign.MatchID
	h.logf("Match started: your model argues %s.\n", assign.Side)
	if warmer, ok := h.Model.(Warmer); ok {
		// Load the model while the players write their prompts.
		h.workers.Go(func() {
			warmCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
			defer cancel()
			_ = warmer.Warm(warmCtx)
		})
	}
}

func (h *Handler) startTurn(ctx context.Context, request protocol.TurnRequest, send Send) {
	fail := func(code, message string) {
		send(protocol.TypeError, protocol.Error{Code: code, Message: message, TurnID: request.TurnID})
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.matchID == "" {
		// Restarted mid-match before the server re-sent MATCH_ASSIGN.
		h.matchID = request.MatchID
	}
	if request.MatchID != h.matchID {
		fail(protocol.CodeBusy, "Already playing another match")
		return
	}
	if h.turn != nil {
		fail(protocol.CodeBusy, "A turn is already in progress")
		return
	}
	deadline, err := time.Parse(time.RFC3339Nano, request.Deadline)
	if err != nil {
		fail(protocol.CodeBadMessage, "Invalid deadline")
		return
	}
	turnCtx, cancel := context.WithDeadline(ctx, deadline)
	current := &turn{id: request.TurnID, cancel: cancel}
	h.turn = current
	messages := make([]model.Message, len(request.Messages))
	for i, m := range request.Messages {
		messages[i] = model.Message{Role: m.Role, Content: m.Content}
	}
	h.workers.Go(func() {
		defer h.endTurn(current)
		h.play(turnCtx, ctx, request.TurnID, model.TurnRequest{Messages: messages, MaxTokens: request.MaxTokens}, send)
	})
}

// play streams one turn. Once the turn is cancelled (match over, connection
// lost), nothing more is sent for it; a passed deadline is MODEL_TIMEOUT.
func (h *Handler) play(turnCtx, connCtx context.Context, turnID string, request model.TurnRequest, send Send) {
	fail := func(err error) {
		if turnCtx.Err() != nil && !errors.Is(turnCtx.Err(), context.DeadlineExceeded) || connCtx.Err() != nil {
			return // cancelled on purpose
		}
		code := protocol.CodeModelError
		switch {
		case errors.Is(turnCtx.Err(), context.DeadlineExceeded), errors.Is(err, context.DeadlineExceeded):
			code = protocol.CodeModelTimeout
		case errors.Is(err, model.ErrUnavailable):
			code = protocol.CodeModelUnavailable
		}
		h.logf("Turn failed: %s.\n", code)
		send(protocol.TypeError, protocol.Error{Code: code, Message: errMessage(err), TurnID: turnID})
	}
	chunks, err := h.Model.Stream(turnCtx, request)
	if err != nil {
		fail(err)
		return
	}
	sent := 0
	for chunk := range chunks {
		if turnCtx.Err() != nil {
			continue // drain without forwarding late output
		}
		switch {
		case chunk.Err != nil:
			fail(chunk.Err)
			return
		case chunk.Delta != "":
			sent += len(chunk.Delta)
			if !send(protocol.TypeMatchResponse, protocol.MatchResponse{TurnID: turnID, Delta: chunk.Delta}) {
				return
			}
		}
		if chunk.Done {
			send(protocol.TypeMatchResponse, protocol.MatchResponse{TurnID: turnID, Done: true, FinishReason: chunk.FinishReason})
			h.logf("Turn done: sent %d characters.\n", sent)
			return
		}
	}
	// Closed without a result: cancelled, timed out, or an incomplete stream.
	fail(fmt.Errorf("%w: stream ended early", model.ErrBadResponse))
}

func (h *Handler) finish(matchID string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if matchID == "" || matchID != h.matchID {
		return false
	}
	h.stopTurn()
	h.matchID = ""
	return true
}

// stopTurn cancels the turn in progress; h.mu must be held.
func (h *Handler) stopTurn() {
	if h.turn != nil {
		h.turn.cancel()
		h.turn = nil
	}
}

func (h *Handler) endTurn(t *turn) {
	t.cancel()
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.turn == t {
		h.turn = nil
	}
}

func (h *Handler) logf(format string, args ...any) {
	if h.Log != nil {
		fmt.Fprintf(h.Log, format, args...)
	}
}

// errMessage is a short description for the server, never prompt content.
func errMessage(err error) string {
	message := err.Error()
	if len(message) > 200 {
		message = message[:200]
	}
	return message
}
