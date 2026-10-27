// Package conn is BILC's ConnectionManager: it keeps one authenticated
// WebSocket open to the server (BILC.md, "Components"). It does not
// interpret match messages.
package conn

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"github.com/chickenfaight/chickenfaight/bilc/internal/auth"
	"github.com/chickenfaight/chickenfaight/bilc/internal/protocol"
)

var (
	ErrOutdated = errors.New("this BILC version is no longer supported; run `bilc update` (until it exists, re-run install.sh)")
	ErrReplaced = errors.New("another BILC connected with this device's credentials, so this one stopped")
)

// TokenSource returns an access token; force skips any cached one.
type TokenSource func(ctx context.Context, force bool) (string, error)

// MessageHandler takes the frames the connection doesn't handle itself (the
// match messages). Handle must not block; send queues a frame on the current
// connection and returns false once it is gone.
type MessageHandler interface {
	Handle(ctx context.Context, env protocol.Envelope, send func(typ string, payload any) bool) bool
	Disconnected()
}

// Manager connects, reconnects, and keeps the socket alive.
type Manager struct {
	URL     string // ws:// or wss:// URL of /v1/bilc/ws
	Token   TokenSource
	Hello   protocol.Hello
	Log     io.Writer      // progress messages; nil discards them
	Handler MessageHandler // nil replies UNKNOWN_TYPE to match messages

	// Zero values use the defaults below; tests shorten them.
	HandshakeTimeout time.Duration
	MinBackoff       time.Duration
	MaxBackoff       time.Duration
}

const (
	defaultHandshakeTimeout = 15 * time.Second
	defaultMinBackoff       = time.Second
	defaultMaxBackoff       = 30 * time.Second
	// The server's timeout is 3 heartbeat intervals (15 s / 45 s); ours matches.
	heartbeatTimeoutIntervals = 3
	writeTimeout              = 10 * time.Second
	readLimit                 = 1 << 20
)

// errRejected means the server refused our credentials; refresh them and retry.
var errRejected = errors.New("server rejected the access token")

// Run stays connected until ctx is cancelled (returns nil after a graceful
// DISCONNECT) or an error that retrying can't fix: not paired
// (auth.ErrNotPaired), ErrOutdated, or ErrReplaced.
func (m *Manager) Run(ctx context.Context) error {
	backoff := m.minBackoff()
	force := false
	for {
		handshook, err := m.connect(ctx, force)
		if ctx.Err() != nil {
			return nil
		}
		if errors.Is(err, auth.ErrNotPaired) || errors.Is(err, ErrOutdated) || errors.Is(err, ErrReplaced) {
			return err
		}
		// A rejected token gets one immediate refresh; if the device was
		// revoked, the refresh fails with auth.ErrNotPaired above.
		force = errors.Is(err, errRejected)
		if handshook {
			backoff = m.minBackoff()
		}
		wait := backoff/2 + rand.N(backoff/2+1)
		m.logf("Disconnected from server (%v); reconnecting in %s.\n", err, wait.Round(100*time.Millisecond))
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(wait):
		}
		backoff = min(backoff*2, m.maxBackoff())
	}
}

// connect runs one connection. handshook reports whether HELLO_ACK arrived.
func (m *Manager) connect(ctx context.Context, force bool) (handshook bool, err error) {
	token, err := m.Token(ctx, force)
	if err != nil {
		return false, err
	}
	dialCtx, cancel := context.WithTimeout(ctx, m.handshakeTimeout())
	defer cancel()
	c, resp, err := websocket.Dial(dialCtx, m.URL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": {"Bearer " + token}},
	})
	if err != nil {
		// The server rejects bad tokens before accepting, which reaches us as an HTTP error.
		if resp != nil && (resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden) {
			return false, errRejected
		}
		return false, fmt.Errorf("connect: %w", err)
	}
	defer c.CloseNow()
	c.SetReadLimit(readLimit)

	interval, err := m.handshake(dialCtx, c)
	if err != nil {
		return false, closeError(err)
	}
	m.logf("Connected to server.\n")
	err = m.serve(ctx, c, interval)
	if m.Handler != nil {
		m.Handler.Disconnected()
	}
	return true, closeError(err)
}

func (m *Manager) handshake(ctx context.Context, c *websocket.Conn) (time.Duration, error) {
	frame, err := protocol.Encode(protocol.TypeHello, m.Hello)
	if err != nil {
		return 0, err
	}
	if err := c.Write(ctx, websocket.MessageText, frame); err != nil {
		return 0, err
	}
	for {
		env, err := readEnvelope(ctx, c)
		if err != nil {
			return 0, err
		}
		switch env.Type {
		case protocol.TypeHelloAck:
			var ack protocol.HelloAck
			if err := json.Unmarshal(env.Payload, &ack); err != nil || ack.ProtocolVersion != protocol.Version || ack.HeartbeatIntervalS <= 0 {
				return 0, errors.New("server sent an invalid HELLO_ACK")
			}
			return time.Duration(ack.HeartbeatIntervalS * float64(time.Second)), nil
		case protocol.TypeError:
			var e protocol.Error
			_ = json.Unmarshal(env.Payload, &e)
			return 0, fmt.Errorf("server rejected HELLO: %s %s", e.Code, e.Message)
		}
		// Anything else before HELLO_ACK (e.g. an early heartbeat) is ignored.
	}
}

// serve reads until the connection ends. Every outgoing frame goes through one
// writer goroutine. Cancelling ctx sends DISCONNECT and closes normally.
func (m *Manager) serve(ctx context.Context, c *websocket.Conn, interval time.Duration) error {
	// The connection's own context, so cancelling ctx closes gracefully instead of abruptly.
	connCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	out := make(chan []byte, 16)
	closing := make(chan struct{})
	writerDone := make(chan error, 1)
	go func() { writerDone <- write(connCtx, c, out, closing) }()
	readerDone := make(chan error, 1)
	go func() { readerDone <- m.read(connCtx, c, out, interval*heartbeatTimeoutIntervals) }()

	select {
	case <-ctx.Done():
		close(closing)
		select {
		case <-writerDone:
		case <-time.After(writeTimeout):
		}
		return nil
	case err := <-readerDone:
		return err
	case err := <-writerDone:
		return err
	}
}

func (m *Manager) read(ctx context.Context, c *websocket.Conn, out chan<- []byte, timeout time.Duration) error {
	// A timer rather than a read deadline: an expired read context drops the
	// connection without a close frame, and the server should see 4408.
	sender := func(typ string, payload any) bool {
		frame, err := protocol.Encode(typ, payload)
		if err != nil {
			return false
		}
		select {
		case out <- frame:
			return true
		case <-ctx.Done():
			return false
		}
	}
	var timedOut atomic.Bool
	watchdog := time.AfterFunc(timeout, func() {
		timedOut.Store(true)
		c.Close(protocol.CloseHeartbeatTimeout, "Heartbeat timeout")
	})
	defer watchdog.Stop()
	for {
		env, err := readEnvelope(ctx, c)
		if timedOut.Load() {
			return errors.New("no message from the server within the heartbeat timeout")
		}
		if err != nil {
			return err
		}
		watchdog.Reset(timeout)
		var reply []byte
		switch env.Type {
		case protocol.TypeHeartbeat:
			// Echo unchanged, as PROTOCOL.md requires.
			reply, err = json.Marshal(env)
		case protocol.TypeError:
			var e protocol.Error
			_ = json.Unmarshal(env.Payload, &e)
			m.logf("Server reported an error: %s %s\n", e.Code, e.Message)
		case protocol.TypeDisconnect:
			return errors.New("server disconnected")
		default:
			if m.Handler != nil && m.Handler.Handle(ctx, env, sender) {
				continue
			}
			reply, err = protocol.Encode(protocol.TypeError, protocol.Error{Code: "UNKNOWN_TYPE", Message: "Unknown message type"})
		}
		if err != nil {
			return err
		}
		if reply != nil {
			select {
			case out <- reply:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}
}

func write(ctx context.Context, c *websocket.Conn, out <-chan []byte, closing <-chan struct{}) error {
	send := func(frame []byte) error {
		writeCtx, cancel := context.WithTimeout(ctx, writeTimeout)
		defer cancel()
		return c.Write(writeCtx, websocket.MessageText, frame)
	}
	for {
		select {
		case frame := <-out:
			if err := send(frame); err != nil {
				return err
			}
		case <-closing:
			if frame, err := protocol.Encode(protocol.TypeDisconnect, protocol.Disconnect{Reason: "shutting down"}); err == nil {
				_ = send(frame)
			}
			return c.Close(websocket.StatusNormalClosure, "")
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func readEnvelope(ctx context.Context, c *websocket.Conn) (protocol.Envelope, error) {
	for {
		typ, data, err := c.Read(ctx)
		if err != nil {
			return protocol.Envelope{}, err
		}
		var env protocol.Envelope
		if typ != websocket.MessageText || json.Unmarshal(data, &env) != nil || env.Type == "" {
			// Not ours to crash on; PROTOCOL.md frames are JSON text.
			continue
		}
		return env, nil
	}
}

// closeError maps PROTOCOL.md close codes to what Run should do.
func closeError(err error) error {
	switch websocket.CloseStatus(err) {
	case protocol.CloseUnauthenticated, protocol.CloseForbidden:
		return errRejected
	case protocol.CloseOutdated:
		return ErrOutdated
	case protocol.CloseReplaced:
		return ErrReplaced
	}
	return err
}

func (m *Manager) logf(format string, args ...any) {
	if m.Log != nil {
		fmt.Fprintf(m.Log, format, args...)
	}
}

func (m *Manager) handshakeTimeout() time.Duration {
	if m.HandshakeTimeout > 0 {
		return m.HandshakeTimeout
	}
	return defaultHandshakeTimeout
}

func (m *Manager) minBackoff() time.Duration {
	if m.MinBackoff > 0 {
		return m.MinBackoff
	}
	return defaultMinBackoff
}

func (m *Manager) maxBackoff() time.Duration {
	if m.MaxBackoff > 0 {
		return m.MaxBackoff
	}
	return defaultMaxBackoff
}
