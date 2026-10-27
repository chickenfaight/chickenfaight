package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chickenfaight/chickenfaight/bilc/internal/auth"
	"github.com/chickenfaight/chickenfaight/bilc/internal/config"
)

type memStore map[string]string

func (m memStore) Load(id string) (string, error) {
	if token, ok := m[id]; ok {
		return token, nil
	}
	return "", auth.ErrNoCredentials
}
func (m memStore) Save(id, token string) error { m[id] = token; return nil }
func (m memStore) Delete(id string) error      { delete(m, id); return nil }

// fakeServer plays the server's BILC REST routes for one pairing code.
type fakeServer struct {
	*httptest.Server
	mu         sync.Mutex
	code       string
	refresh    string
	registered []map[string]string
	revoked    bool
}

func newFakeServer(t *testing.T) *fakeServer {
	f := &fakeServer{code: "ABCD2345"}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"status":"healthy"}`)
	})
	mux.HandleFunc("POST /v1/bilc/register", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		defer f.mu.Unlock()
		if body["pairing_code"] != f.code {
			w.WriteHeader(http.StatusBadRequest)
			fmt.Fprint(w, `{"code":"PAIRING_CODE_INVALID","detail":"That pairing code is wrong, used, or expired."}`)
			return
		}
		f.code = "" // single use
		f.registered = append(f.registered, body)
		f.refresh = "refresh-1"
		fmt.Fprint(w, `{"bilc_id":"device-1","refresh_token":"refresh-1"}`)
	})
	mux.HandleFunc("POST /v1/bilc/token", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.revoked || body["refresh_token"] != f.refresh {
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprint(w, `{"code":"TOKEN_INVALID","detail":"This device isn't paired anymore."}`)
			return
		}
		f.refresh += "+"
		json.NewEncoder(w).Encode(map[string]any{
			"access_token": "access", "refresh_token": f.refresh, "expires_at": time.Now().Add(15 * time.Minute),
		})
	})
	f.Server = httptest.NewServer(mux)
	t.Cleanup(f.Close)
	return f
}

type harness struct {
	cli            *cli
	stdout, stderr *bytes.Buffer
	store          memStore
}

func newHarness(t *testing.T) *harness {
	h := &harness{stdout: &bytes.Buffer{}, stderr: &bytes.Buffer{}, store: memStore{}}
	h.cli = &cli{stdout: h.stdout, stderr: h.stderr, configDir: t.TempDir(), store: h.store}
	return h
}

func (h *harness) config(t *testing.T) config.Config {
	t.Helper()
	cfg, _, err := h.cli.loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

func TestPairStoresCredentialsAndConfig(t *testing.T) {
	server := newFakeServer(t)
	h := newHarness(t)
	if err := h.cli.run([]string{"pair", "ABCD2345", "--server", server.URL, "--name", "laptop"}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(h.stdout.String(), `Paired as "laptop"`) {
		t.Fatalf("stdout = %q", h.stdout.String())
	}
	cfg := h.config(t)
	if cfg.BilcID != "device-1" || cfg.ServerURL != server.URL {
		t.Fatalf("config = %+v", cfg)
	}
	if h.store["device-1"] != "refresh-1" {
		t.Fatalf("store = %v", h.store)
	}
	server.mu.Lock()
	got := server.registered[0]
	server.mu.Unlock()
	if got["device_name"] != "laptop" || got["platform"] != platform() || got["client_version"] != version {
		t.Fatalf("registered %v", got)
	}
	// The config file never holds the token, and only this user can read it.
	path := filepath.Join(h.cli.configDir, "config.json")
	data, _ := os.ReadFile(path)
	if strings.Contains(string(data), "refresh-1") {
		t.Fatal("config file contains the refresh token")
	}
	if info, _ := os.Stat(path); info.Mode().Perm() != 0o600 {
		t.Fatalf("config mode = %v", info.Mode().Perm())
	}
}

func TestPairRejectsWrongCode(t *testing.T) {
	server := newFakeServer(t)
	h := newHarness(t)
	err := h.cli.run([]string{"pair", "WRONG234", "--server", server.URL})
	if err == nil || !strings.Contains(err.Error(), "wrong, used, or expired") {
		t.Fatalf("error = %v", err)
	}
	if len(h.store) != 0 || h.config(t).BilcID != "" {
		t.Fatal("a failed pairing saved something")
	}
}

func TestPairRefusesWhenAlreadyPaired(t *testing.T) {
	server := newFakeServer(t)
	h := newHarness(t)
	if err := h.cli.run([]string{"pair", "ABCD2345", "--server", server.URL}); err != nil {
		t.Fatal(err)
	}
	if err := h.cli.run([]string{"pair", "ABCD2345"}); err == nil || !strings.Contains(err.Error(), "already paired") {
		t.Fatalf("error = %v", err)
	}
}

func TestPairWarnsAboutPlainHTTPOverTheNetwork(t *testing.T) {
	h := newHarness(t)
	// .invalid never resolves, so pairing fails quickly after the warning.
	_ = h.cli.run([]string{"pair", "ABCD2345", "--server", "http://bilc-test.invalid"})
	if !strings.Contains(h.stderr.String(), "isn't HTTPS") {
		t.Fatalf("stderr = %q", h.stderr.String())
	}
}

func TestUnpairDeletesCredentials(t *testing.T) {
	server := newFakeServer(t)
	h := newHarness(t)
	if err := h.cli.run([]string{"pair", "ABCD2345", "--server", server.URL}); err != nil {
		t.Fatal(err)
	}
	if err := h.cli.run([]string{"unpair"}); err != nil {
		t.Fatal(err)
	}
	if len(h.store) != 0 || h.config(t).BilcID != "" {
		t.Fatalf("store = %v, config = %+v", h.store, h.config(t))
	}
	if !strings.Contains(h.stdout.String(), "revoke this device") {
		t.Fatalf("stdout = %q", h.stdout.String())
	}
}

func TestStatusChecksTheServerAcceptsTheDevice(t *testing.T) {
	server := newFakeServer(t)
	h := newHarness(t)
	if err := h.cli.run([]string{"pair", "ABCD2345", "--server", server.URL}); err != nil {
		t.Fatal(err)
	}
	h.stdout.Reset()
	if err := h.cli.run([]string{"status"}); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"(reachable)", "server accepts this device", "Model:   not set"} {
		if !strings.Contains(h.stdout.String(), want) {
			t.Fatalf("stdout = %q, want %q", h.stdout.String(), want)
		}
	}
	// The check rotated the token, and the new one was stored.
	if h.store["device-1"] != "refresh-1+" {
		t.Fatalf("store = %v", h.store)
	}
}

func TestStatusForgetsARevokedDevice(t *testing.T) {
	server := newFakeServer(t)
	h := newHarness(t)
	if err := h.cli.run([]string{"pair", "ABCD2345", "--server", server.URL}); err != nil {
		t.Fatal(err)
	}
	server.mu.Lock()
	server.revoked = true
	server.mu.Unlock()
	h.stdout.Reset()
	if err := h.cli.run([]string{"status"}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(h.stdout.String(), "Paired:  no; the server no longer accepts this device") {
		t.Fatalf("stdout = %q", h.stdout.String())
	}
	if len(h.store) != 0 || h.config(t).BilcID != "" {
		t.Fatal("revoked credentials were kept")
	}
}

func TestModelSet(t *testing.T) {
	h := newHarness(t)
	if err := h.cli.run([]string{"model", "set", "--model", "llama3.2:3b"}); err != nil {
		t.Fatal(err)
	}
	if got := h.config(t).Model; got != (config.Model{BaseURL: config.DefaultModelURL, Name: "llama3.2:3b"}) {
		t.Fatalf("model = %+v", got)
	}
	if h.stderr.Len() != 0 {
		t.Fatalf("unexpected warning: %q", h.stderr.String())
	}
	if err := h.cli.run([]string{"model", "set", "--model", "big", "--url", "https://models.example.com/v1"}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(h.stderr.String(), "prompts will leave it") {
		t.Fatalf("stderr = %q", h.stderr.String())
	}
}

func TestModelSetValidates(t *testing.T) {
	for _, args := range [][]string{
		{"model", "set"},
		{"model", "set", "--model", "  "},
		{"model", "set", "--model", "m", "--url", "ftp://x"},
		{"model", "set", "--model", "m", "--url", "not a url"},
		{"model", "set", "--model", "m", "extra"},
	} {
		h := newHarness(t)
		if err := h.cli.run(args); err == nil {
			t.Fatalf("%v: expected an error", args)
		}
	}
}

func TestRunNeedsPairingAndModel(t *testing.T) {
	h := newHarness(t)
	if err := h.cli.run([]string{"run"}); !errors.Is(err, auth.ErrNotPaired) {
		t.Fatalf("error = %v", err)
	}
	server := newFakeServer(t)
	if err := h.cli.run([]string{"pair", "ABCD2345", "--server", server.URL}); err != nil {
		t.Fatal(err)
	}
	if err := h.cli.run([]string{"run"}); err == nil || !strings.Contains(err.Error(), "bilc model set") {
		t.Fatalf("error = %v", err)
	}
}

func TestSocketURL(t *testing.T) {
	for in, want := range map[string]string{
		"http://localhost:8000":        "ws://localhost:8000/v1/bilc/ws",
		"https://api.example.com/":     "wss://api.example.com/v1/bilc/ws",
		"https://example.com/chicken/": "wss://example.com/chicken/v1/bilc/ws",
	} {
		u, err := config.ParseHTTPURL(in)
		if err != nil {
			t.Fatal(err)
		}
		if got := socketURL(u); got != want {
			t.Errorf("socketURL(%s) = %s, want %s", in, got, want)
		}
	}
}
