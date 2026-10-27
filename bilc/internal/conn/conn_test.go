package conn

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/chickenfaight/chickenfaight/bilc/internal/auth"
	"github.com/chickenfaight/chickenfaight/bilc/internal/protocol"
)

var hello = protocol.Hello{
	ProtocolVersion: protocol.Version,
	ClientVersion:   "1.2.3",
	Platform:        "linux/amd64",
	Model:           protocol.HelloModel{Name: "llama3.2:3b", Metadata: map[string]any{}},
}

// fakeServer runs handle for each accepted connection; n counts them from 1.
func fakeServer(t *testing.T, handle func(ctx context.Context, n int, c *websocket.Conn, r *http.Request)) string {
	t.Helper()
	var count atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := int(count.Add(1))
		if r.Header.Get("Authorization") == "Bearer reject" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			t.Errorf("accept: %v", err)
			return
		}
		defer c.CloseNow()
		handle(r.Context(), n, c, r)
	}))
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http")
}

func read(ctx context.Context, t *testing.T, c *websocket.Conn) protocol.Envelope {
	t.Helper()
	_, data, err := c.Read(ctx)
	if err != nil {
		t.Errorf("server read: %v", err)
		return protocol.Envelope{}
	}
	var env protocol.Envelope
	if err := json.Unmarshal(data, &env); err != nil {
		t.Errorf("server got non-JSON %q", data)
	}
	return env
}

func send(ctx context.Context, c *websocket.Conn, raw string) {
	_ = c.Write(ctx, websocket.MessageText, []byte(raw))
}

// accept completes the handshake with the given heartbeat interval.
func accept(ctx context.Context, t *testing.T, c *websocket.Conn, interval float64) protocol.Hello {
	t.Helper()
	env := read(ctx, t, c)
	if env.Type != protocol.TypeHello {
		t.Errorf("first frame = %s, want HELLO", env.Type)
	}
	var got protocol.Hello
	_ = json.Unmarshal(env.Payload, &got)
	ack, _ := protocol.Encode(protocol.TypeHelloAck, protocol.HelloAck{ProtocolVersion: 1, HeartbeatIntervalS: interval})
	_ = c.Write(ctx, websocket.MessageText, ack)
	return got
}

// stopAfterConnected waits until the client is serving (a heartbeat round
// trip), then cancels it like Ctrl-C and waits for its DISCONNECT.
func stopAfterConnected(ctx context.Context, t *testing.T, c *websocket.Conn, cancel context.CancelFunc) {
	t.Helper()
	send(ctx, c, `{"type":"HEARTBEAT","payload":{"ts":1}}`)
	read(ctx, t, c)
	cancel()
	if env := read(ctx, t, c); env.Type != protocol.TypeDisconnect {
		t.Errorf("got %s, want DISCONNECT", env.Type)
	}
}

func token(string) TokenSource {
	return func(context.Context, bool) (string, error) { return "tok", nil }
}

func manager(url string, tokens TokenSource) *Manager {
	return &Manager{URL: url, Token: tokens, Hello: hello, MinBackoff: 5 * time.Millisecond, MaxBackoff: 20 * time.Millisecond,
		HandshakeTimeout: 2 * time.Second}
}

func runAsync(ctx context.Context, m *Manager) <-chan error {
	done := make(chan error, 1)
	go func() { done <- m.Run(ctx) }()
	return done
}

func wait(t *testing.T, done <-chan error) error {
	t.Helper()
	select {
	case err := <-done:
		return err
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not return")
		return nil
	}
}

func TestHelloHeartbeatAndGracefulDisconnect(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	finished := make(chan struct{})
	url := fakeServer(t, func(sctx context.Context, n int, c *websocket.Conn, r *http.Request) {
		defer close(finished)
		if got := r.Header.Get("Authorization"); got != "Bearer tok" {
			t.Errorf("Authorization = %q", got)
		}
		got := accept(sctx, t, c, 15)
		if got.ProtocolVersion != 1 || got.ClientVersion != "1.2.3" || got.Platform != "linux/amd64" || got.Model.Name != "llama3.2:3b" {
			t.Errorf("HELLO = %+v", got)
		}
		beat := `{"type":"HEARTBEAT","payload":{"ts":1730000000.25}}`
		send(sctx, c, beat)
		echo := read(sctx, t, c)
		if echo.Type != protocol.TypeHeartbeat || string(echo.Payload) != `{"ts":1730000000.25}` {
			t.Errorf("echo = %s %s", echo.Type, echo.Payload)
		}
		cancel() // Ctrl-C
		if env := read(sctx, t, c); env.Type != protocol.TypeDisconnect {
			t.Errorf("got %s, want DISCONNECT", env.Type)
		}
		_, _, err := c.Read(sctx)
		if status := websocket.CloseStatus(err); status != websocket.StatusNormalClosure {
			t.Errorf("close status = %v (%v)", status, err)
		}
	})
	if err := wait(t, runAsync(ctx, manager(url, token("tok")))); err != nil {
		t.Fatalf("Run = %v, want nil after Ctrl-C", err)
	}
	<-finished
}

func TestUnknownTypeGetsAnError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	url := fakeServer(t, func(sctx context.Context, n int, c *websocket.Conn, r *http.Request) {
		accept(sctx, t, c, 15)
		send(sctx, c, `{"type":"SOMETHING_NEW","payload":{}}`)
		env := read(sctx, t, c)
		var e protocol.Error
		_ = json.Unmarshal(env.Payload, &e)
		if env.Type != protocol.TypeError || e.Code != "UNKNOWN_TYPE" {
			t.Errorf("reply = %s %+v", env.Type, e)
		}
		// Garbage is ignored rather than crashing the client; it stays connected.
		send(sctx, c, `not json`)
		stopAfterConnected(sctx, t, c, cancel)
	})
	if err := wait(t, runAsync(ctx, manager(url, token("tok")))); err != nil {
		t.Fatal(err)
	}
}

func TestReconnectsAfterTheConnectionDrops(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	url := fakeServer(t, func(sctx context.Context, n int, c *websocket.Conn, r *http.Request) {
		accept(sctx, t, c, 15)
		if n < 3 {
			c.Close(protocol.CloseHeartbeatTimeout, "Heartbeat timeout")
			return
		}
		stopAfterConnected(sctx, t, c, cancel)
	})
	if err := wait(t, runAsync(ctx, manager(url, token("tok")))); err != nil {
		t.Fatal(err)
	}
}

func TestSilentServerTimesOutAndReconnects(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	url := fakeServer(t, func(sctx context.Context, n int, c *websocket.Conn, r *http.Request) {
		if n == 1 {
			accept(sctx, t, c, 0.02) // then say nothing
			_, _, err := c.Read(sctx)
			if status := websocket.CloseStatus(err); status != protocol.CloseHeartbeatTimeout {
				t.Errorf("close status = %v (%v)", status, err)
			}
			return
		}
		accept(sctx, t, c, 15)
		stopAfterConnected(sctx, t, c, cancel)
	})
	if err := wait(t, runAsync(ctx, manager(url, token("tok")))); err != nil {
		t.Fatal(err)
	}
}

func TestRejectedTokenIsRefreshedOnce(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var mu sync.Mutex
	var forced []bool
	tokens := func(_ context.Context, force bool) (string, error) {
		mu.Lock()
		defer mu.Unlock()
		forced = append(forced, force)
		if len(forced) == 1 {
			return "reject", nil // the server refuses this one before accepting
		}
		return "tok", nil
	}
	url := fakeServer(t, func(sctx context.Context, n int, c *websocket.Conn, r *http.Request) {
		accept(sctx, t, c, 15)
		if n == 2 {
			// Revoked mid-connection: refresh again before reconnecting.
			c.Close(protocol.CloseForbidden, "Device revoked")
			return
		}
		stopAfterConnected(sctx, t, c, cancel)
	})
	if err := wait(t, runAsync(ctx, manager(url, tokens))); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(forced) != 3 || forced[0] || !forced[1] || !forced[2] {
		t.Fatalf("force flags = %v, want [false true true]", forced)
	}
}

func TestStopsWhenNoLongerPaired(t *testing.T) {
	tokens := func(context.Context, bool) (string, error) { return "", auth.ErrNotPaired }
	err := wait(t, runAsync(context.Background(), manager("ws://127.0.0.1:1", tokens)))
	if !errors.Is(err, auth.ErrNotPaired) {
		t.Fatalf("Run = %v", err)
	}
}

func TestStopsOnCloseCodesRetryingCantFix(t *testing.T) {
	for code, want := range map[websocket.StatusCode]error{
		protocol.CloseOutdated: ErrOutdated,
		protocol.CloseReplaced: ErrReplaced,
	} {
		url := fakeServer(t, func(sctx context.Context, n int, c *websocket.Conn, r *http.Request) {
			accept(sctx, t, c, 15)
			c.Close(code, "")
		})
		if err := wait(t, runAsync(context.Background(), manager(url, token("tok")))); !errors.Is(err, want) {
			t.Fatalf("close %d: Run = %v, want %v", code, err, want)
		}
	}
}

func TestCancelWhileReconnecting(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	m := manager("ws://127.0.0.1:1", token("tok"))
	m.MinBackoff, m.MaxBackoff = time.Hour, time.Hour
	done := runAsync(ctx, m)
	time.Sleep(50 * time.Millisecond)
	cancel()
	if err := wait(t, done); err != nil {
		t.Fatalf("Run = %v, want nil", err)
	}
}

// echoHandler answers MATCH_ASSIGN with an ERROR, as a stand-in for the match handler.
type echoHandler struct {
	disconnected atomic.Int32
}

func (h *echoHandler) Handle(ctx context.Context, env protocol.Envelope, send func(string, any) bool) bool {
	if env.Type != protocol.TypeMatchAssign {
		return false
	}
	send(protocol.TypeError, protocol.Error{Code: "BILC_BUSY", Message: "handled"})
	return true
}

func (h *echoHandler) Disconnected() { h.disconnected.Add(1) }

func TestMatchMessagesGoToTheHandler(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	handler := &echoHandler{}
	url := fakeServer(t, func(sctx context.Context, n int, c *websocket.Conn, r *http.Request) {
		accept(sctx, t, c, 15)
		send(sctx, c, `{"type":"MATCH_ASSIGN","payload":{"match_id":"m1","side":"pro","topic":"t"}}`)
		env := read(sctx, t, c)
		var e protocol.Error
		_ = json.Unmarshal(env.Payload, &e)
		if env.Type != protocol.TypeError || e.Message != "handled" {
			t.Errorf("reply = %s %+v", env.Type, e)
		}
		stopAfterConnected(sctx, t, c, cancel)
	})
	m := manager(url, token("tok"))
	m.Handler = handler
	if err := wait(t, runAsync(ctx, m)); err != nil {
		t.Fatal(err)
	}
	if handler.disconnected.Load() != 1 {
		t.Fatalf("Disconnected called %d times", handler.disconnected.Load())
	}
}
