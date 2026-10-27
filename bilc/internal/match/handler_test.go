package match

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/chickenfaight/chickenfaight/bilc/internal/model"
	"github.com/chickenfaight/chickenfaight/bilc/internal/protocol"
)

// fakeModel streams a scripted turn. hang keeps the stream open until it's cancelled.
type fakeModel struct {
	deltas   []string
	err      error // sent after the deltas instead of Done
	setupErr error
	hang     bool
	closeNow bool // close without a terminal chunk

	mu   sync.Mutex
	got  []model.TurnRequest
	ctxs []context.Context
}

func (f *fakeModel) Info(context.Context) (model.ModelInfo, error) { return model.ModelInfo{}, nil }

func (f *fakeModel) Stream(ctx context.Context, req model.TurnRequest) (<-chan model.Chunk, error) {
	f.mu.Lock()
	f.got = append(f.got, req)
	f.ctxs = append(f.ctxs, ctx)
	f.mu.Unlock()
	if f.setupErr != nil {
		return nil, f.setupErr
	}
	chunks := make(chan model.Chunk)
	go func() {
		defer close(chunks)
		send := func(c model.Chunk) bool {
			select {
			case chunks <- c:
				return true
			case <-ctx.Done():
				return false
			}
		}
		for _, d := range f.deltas {
			if !send(model.Chunk{Delta: d}) {
				return
			}
		}
		switch {
		case f.hang:
			<-ctx.Done()
		case f.closeNow:
		case f.err != nil:
			send(model.Chunk{Err: f.err})
		default:
			stop := "stop"
			send(model.Chunk{Done: true, FinishReason: &stop})
		}
	}()
	return chunks, nil
}

// wire records what the handler sends.
type wire struct {
	mu     sync.Mutex
	frames []protocol.Envelope
	added  chan struct{}
}

func newWire() *wire { return &wire{added: make(chan struct{}, 100)} }

func (w *wire) send(typ string, payload any) bool {
	raw, _ := json.Marshal(payload)
	w.mu.Lock()
	w.frames = append(w.frames, protocol.Envelope{Type: typ, Payload: raw})
	w.mu.Unlock()
	w.added <- struct{}{}
	return true
}

// waitFor returns once a frame of the given type was sent.
func (w *wire) waitFor(t *testing.T, typ string) protocol.Envelope {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		w.mu.Lock()
		for _, f := range w.frames {
			if f.Type == typ {
				w.mu.Unlock()
				return f
			}
		}
		w.mu.Unlock()
		select {
		case <-w.added:
		case <-deadline:
			t.Fatalf("no %s sent; got %v", typ, w.types())
		}
	}
}

func (w *wire) types() []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	var types []string
	for _, f := range w.frames {
		types = append(types, f.Type)
	}
	return types
}

func (w *wire) responses() []protocol.MatchResponse {
	w.mu.Lock()
	defer w.mu.Unlock()
	var out []protocol.MatchResponse
	for _, f := range w.frames {
		if f.Type == protocol.TypeMatchResponse {
			var r protocol.MatchResponse
			json.Unmarshal(f.Payload, &r)
			out = append(out, r)
		}
	}
	return out
}

func envelope(typ string, payload any) protocol.Envelope {
	raw, _ := json.Marshal(payload)
	return protocol.Envelope{Type: typ, Payload: raw}
}

func turnRequest(turnID, matchID string, deadline time.Duration) protocol.Envelope {
	return envelope(protocol.TypeTurnRequest, protocol.TurnRequest{
		TurnID: turnID, MatchID: matchID, Phase: "opening", MaxTokens: 400,
		Messages: []protocol.Message{{Role: "system", Content: "Argue pro."}},
		Deadline: time.Now().Add(deadline).UTC().Format(time.RFC3339Nano),
	})
}

func errorCode(t *testing.T, f protocol.Envelope) protocol.Error {
	t.Helper()
	var e protocol.Error
	if err := json.Unmarshal(f.Payload, &e); err != nil {
		t.Fatal(err)
	}
	return e
}

func start(t *testing.T, m *fakeModel) (*Handler, *wire, context.Context) {
	t.Helper()
	h := &Handler{Model: m}
	w := newWire()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() { cancel(); h.Wait() })
	h.Handle(ctx, envelope(protocol.TypeMatchAssign, protocol.MatchAssign{MatchID: "m1", Side: "pro", Topic: "Transit"}), w.send)
	return h, w, ctx
}

func TestTurnStreamsTheModelsOutput(t *testing.T) {
	m := &fakeModel{deltas: []string{"Free ", "transit!"}}
	h, w, ctx := start(t, m)
	if !h.Handle(ctx, turnRequest("t1", "m1", time.Minute), w.send) {
		t.Fatal("TURN_REQUEST not handled")
	}
	h.Wait()
	got := w.responses()
	if len(got) != 3 || got[0].Delta != "Free " || got[1].Delta != "transit!" || !got[2].Done || *got[2].FinishReason != "stop" {
		t.Fatalf("responses = %+v", got)
	}
	for _, r := range got {
		if r.TurnID != "t1" {
			t.Fatalf("turn id = %q", r.TurnID)
		}
	}
	// Forwarded unchanged.
	if len(m.got) != 1 || m.got[0].MaxTokens != 400 || m.got[0].Messages[0] != (model.Message{Role: "system", Content: "Argue pro."}) {
		t.Fatalf("model got %+v", m.got)
	}
}

func TestModelFailuresMapToErrorCodes(t *testing.T) {
	for name, tc := range map[string]struct {
		m    *fakeModel
		code string
	}{
		"bad response":      {&fakeModel{deltas: []string{"half"}, err: fmt.Errorf("%w: boom", model.ErrBadResponse)}, protocol.CodeModelError},
		"unreachable":       {&fakeModel{setupErr: fmt.Errorf("%w: refused", model.ErrUnavailable)}, protocol.CodeModelUnavailable},
		"closed early":      {&fakeModel{deltas: []string{"half"}, closeNow: true}, protocol.CodeModelError},
		"deadline passed":   {&fakeModel{hang: true}, protocol.CodeModelTimeout},
		"setup bad request": {&fakeModel{setupErr: fmt.Errorf("%w: HTTP 400", model.ErrBadResponse)}, protocol.CodeModelError},
	} {
		t.Run(name, func(t *testing.T) {
			h, w, ctx := start(t, tc.m)
			deadline := time.Minute
			if tc.m.hang {
				deadline = 50 * time.Millisecond
			}
			h.Handle(ctx, turnRequest("t1", "m1", deadline), w.send)
			e := errorCode(t, w.waitFor(t, protocol.TypeError))
			if e.Code != tc.code || e.TurnID != "t1" {
				t.Fatalf("error = %+v, want %s", e, tc.code)
			}
			h.Wait()
			for _, r := range w.responses() {
				if r.Done {
					t.Fatal("a failed turn also reported done")
				}
			}
		})
	}
}

func TestMatchEndCancelsTheTurnWithoutLateOutput(t *testing.T) {
	m := &fakeModel{deltas: []string{"first"}, hang: true}
	h, w, ctx := start(t, m)
	h.Handle(ctx, turnRequest("t1", "m1", time.Minute), w.send)
	w.waitFor(t, protocol.TypeMatchResponse)
	h.Handle(ctx, envelope(protocol.TypeMatchEnd, protocol.MatchEnd{MatchID: "m1", Status: "forfeited"}), w.send)
	h.Wait()
	if !errors.Is(m.ctxs[0].Err(), context.Canceled) {
		t.Fatalf("model context = %v", m.ctxs[0].Err())
	}
	if types := w.types(); len(types) != 1 {
		t.Fatalf("sent %v after the match ended", types)
	}
	// Free for the next match.
	h.Handle(ctx, envelope(protocol.TypeMatchAssign, protocol.MatchAssign{MatchID: "m2", Side: "con"}), w.send)
	if types := w.types(); len(types) != 1 {
		t.Fatalf("new match was refused: %v", types)
	}
}

func TestOneMatchAndOneTurnAtATime(t *testing.T) {
	m := &fakeModel{hang: true}
	h, w, ctx := start(t, m)
	h.Handle(ctx, envelope(protocol.TypeMatchAssign, protocol.MatchAssign{MatchID: "other"}), w.send)
	if e := errorCode(t, w.waitFor(t, protocol.TypeError)); e.Code != protocol.CodeBusy {
		t.Fatalf("second match: %+v", e)
	}
	h.Handle(ctx, turnRequest("t1", "m1", time.Minute), w.send)
	h.Handle(ctx, turnRequest("t2", "m1", time.Minute), w.send)
	h.Handle(ctx, turnRequest("t3", "other", time.Minute), w.send)
	time.Sleep(50 * time.Millisecond)
	var busy []string
	w.mu.Lock()
	for _, f := range w.frames {
		if f.Type == protocol.TypeError {
			var e protocol.Error
			json.Unmarshal(f.Payload, &e)
			busy = append(busy, e.Code+":"+e.TurnID)
		}
	}
	w.mu.Unlock()
	if fmt.Sprint(busy) != "[BILC_BUSY: BILC_BUSY:t2 BILC_BUSY:t3]" {
		t.Fatalf("errors = %v", busy)
	}
	// The same assignment again (after a reconnect) is accepted quietly.
	before := len(w.types())
	h.Handle(ctx, envelope(protocol.TypeMatchAssign, protocol.MatchAssign{MatchID: "m1"}), w.send)
	if len(w.types()) != before {
		t.Fatal("re-sent assignment was refused")
	}
}

func TestDisconnectCancelsTheTurn(t *testing.T) {
	m := &fakeModel{hang: true}
	h, w, ctx := start(t, m)
	h.Handle(ctx, turnRequest("t1", "m1", time.Minute), w.send)
	time.Sleep(20 * time.Millisecond)
	h.Disconnected()
	h.Wait()
	if !errors.Is(m.ctxs[0].Err(), context.Canceled) || len(w.types()) != 0 {
		t.Fatalf("ctx = %v, sent %v", m.ctxs[0].Err(), w.types())
	}
}

func TestForfeitStopsTheTurn(t *testing.T) {
	m := &fakeModel{hang: true}
	h, w, ctx := start(t, m)
	h.Handle(ctx, turnRequest("t1", "m1", time.Minute), w.send)
	time.Sleep(20 * time.Millisecond)
	h.Handle(ctx, envelope(protocol.TypeForfeit, protocol.Forfeit{MatchID: "m1", Reason: "MODEL_TIMEOUT"}), w.send)
	h.Wait()
	if !errors.Is(m.ctxs[0].Err(), context.Canceled) {
		t.Fatalf("ctx = %v", m.ctxs[0].Err())
	}
}

func TestMalformedMatchMessages(t *testing.T) {
	h, w, ctx := start(t, &fakeModel{})
	h.Handle(ctx, protocol.Envelope{Type: protocol.TypeTurnRequest, Payload: json.RawMessage(`{"turn_id":""}`)}, w.send)
	h.Handle(ctx, turnRequest("t1", "m1", time.Minute), w.send) // still works afterwards
	h.Wait()
	if types := w.types(); types[0] != protocol.TypeError || types[len(types)-1] != protocol.TypeMatchResponse {
		t.Fatalf("types = %v", types)
	}
	if h.Handle(ctx, protocol.Envelope{Type: "SOMETHING_ELSE"}, w.send) {
		t.Fatal("non-match message reported as handled")
	}
}
