// Test-only executable for the Go client / Python backend browser contract test.
// Uses memory credentials and a fake local model; never reads user config/keychain.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/chickenfaight/chickenfaight/bilc/internal/auth"
	"github.com/chickenfaight/chickenfaight/bilc/internal/conn"
	"github.com/chickenfaight/chickenfaight/bilc/internal/match"
	"github.com/chickenfaight/chickenfaight/bilc/internal/model"
	"github.com/chickenfaight/chickenfaight/bilc/internal/protocol"
)

type memoryStore struct{ token string }

func (s *memoryStore) Load(string) (string, error)       { return s.token, nil }
func (s *memoryStore) Save(_ string, token string) error { s.token = token; return nil }
func (s *memoryStore) Delete(string) error               { s.token = ""; return nil }

func run() error {
	if len(os.Args) != 4 {
		return fmt.Errorf("expected server, code, fake model URL")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	client := &auth.Client{ServerURL: os.Args[1]}
	registration, err := client.Register(ctx, auth.RegisterRequest{PairingCode: os.Args[2], DeviceName: "Contract device", Platform: "test", ClientVersion: "0.1.0"})
	if err != nil {
		return err
	}
	store := &memoryStore{token: registration.RefreshToken}
	session := &auth.Session{Client: client, Store: store, BilcID: registration.BilcID}
	local := &model.OpenAI{BaseURL: os.Args[3], Name: "contract-model"}
	handler := &match.Handler{Model: local}
	defer handler.Wait()
	manager := &conn.Manager{
		URL:   strings.Replace(os.Args[1], "http://", "ws://", 1) + "/v1/bilc/ws",
		Token: session.AccessToken, Handler: handler,
		Hello: protocol.Hello{ProtocolVersion: 1, ClientVersion: "0.1.0", Platform: "test", Model: protocol.HelloModel{Name: "contract-model", Metadata: map[string]any{"parameter_size": "3B"}}},
	}
	time.AfterFunc(25*time.Second, cancel)
	return manager.Run(ctx)
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
