package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/zalando/go-keyring"
)

type memStore struct {
	tokens  map[string]string
	saveErr error
}

func (m *memStore) Load(id string) (string, error) {
	if token, ok := m.tokens[id]; ok {
		return token, nil
	}
	return "", ErrNoCredentials
}
func (m *memStore) Save(id, token string) error {
	if m.saveErr != nil {
		return m.saveErr
	}
	m.tokens[id] = token
	return nil
}
func (m *memStore) Delete(id string) error { delete(m.tokens, id); return nil }

// tokenServer rotates refresh tokens like the real server; calls counts requests.
func tokenServer(t *testing.T, current *string, calls *int) *Client {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*calls++
		var body map[string]string
		json.NewDecoder(r.Body).Decode(&body)
		if r.URL.Path != "/v1/bilc/token" || body["bilc_id"] != "dev" || body["refresh_token"] != *current {
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprint(w, `{"code":"TOKEN_INVALID","detail":"nope"}`)
			return
		}
		*current = fmt.Sprintf("refresh-%d", *calls)
		json.NewEncoder(w).Encode(map[string]any{
			"access_token": fmt.Sprintf("access-%d", *calls), "refresh_token": *current,
			"expires_at": time.Now().Add(15 * time.Minute),
		})
	}))
	t.Cleanup(srv.Close)
	return &Client{ServerURL: srv.URL}
}

func TestAccessTokenRotatesAndCaches(t *testing.T) {
	current, calls := "refresh-0", 0
	store := &memStore{tokens: map[string]string{"dev": "refresh-0"}}
	s := &Session{Client: tokenServer(t, &current, &calls), Store: store, BilcID: "dev"}
	ctx := context.Background()

	token, err := s.AccessToken(ctx, false)
	if err != nil || token != "access-1" {
		t.Fatalf("AccessToken = %q, %v", token, err)
	}
	if store.tokens["dev"] != "refresh-1" {
		t.Fatalf("stored %q, want the rotated token", store.tokens["dev"])
	}
	if token, _ := s.AccessToken(ctx, false); token != "access-1" || calls != 1 {
		t.Fatalf("cached token not reused: %q after %d calls", token, calls)
	}
	if token, _ := s.AccessToken(ctx, true); token != "access-2" || store.tokens["dev"] != "refresh-2" {
		t.Fatalf("force = %q, stored %q", token, store.tokens["dev"])
	}
	// Close to expiry, it refreshes on its own.
	s.Now = func() time.Time { return time.Now().Add(14*time.Minute + 30*time.Second) }
	if token, _ := s.AccessToken(ctx, false); token != "access-3" {
		t.Fatalf("near expiry = %q", token)
	}
}

func TestRejectedDeviceLosesItsCredentials(t *testing.T) {
	current, calls := "something-else", 0
	store := &memStore{tokens: map[string]string{"dev": "refresh-0"}}
	s := &Session{Client: tokenServer(t, &current, &calls), Store: store, BilcID: "dev"}
	_, err := s.AccessToken(context.Background(), false)
	if !errors.Is(err, ErrNotPaired) {
		t.Fatalf("err = %v", err)
	}
	if _, ok := store.tokens["dev"]; ok {
		t.Fatal("credentials kept after TOKEN_INVALID")
	}
}

func TestNoCredentialsMeansNotPaired(t *testing.T) {
	s := &Session{Client: &Client{ServerURL: "http://127.0.0.1:1"}, Store: &memStore{tokens: map[string]string{}}, BilcID: "dev"}
	if _, err := s.AccessToken(context.Background(), false); !errors.Is(err, ErrNotPaired) {
		t.Fatalf("err = %v", err)
	}
}

func TestUnsavedRotationIsAnError(t *testing.T) {
	current, calls := "refresh-0", 0
	store := &memStore{tokens: map[string]string{"dev": "refresh-0"}, saveErr: errors.New("disk full")}
	s := &Session{Client: tokenServer(t, &current, &calls), Store: store, BilcID: "dev"}
	if _, err := s.AccessToken(context.Background(), false); err == nil || !strings.Contains(err.Error(), "disk full") {
		t.Fatalf("err = %v", err)
	}
}

func TestServerErrorsKeepTheirCode(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		fmt.Fprint(w, `{"code":"RATE_LIMITED","detail":"Too many requests. Try again shortly."}`)
	}))
	defer srv.Close()
	_, err := (&Client{ServerURL: srv.URL}).Register(context.Background(), RegisterRequest{})
	if !HasCode(err, "RATE_LIMITED") || err.Error() != "Too many requests. Try again shortly." {
		t.Fatalf("err = %v", err)
	}
}

func TestStoreFallsBackToAPrivateFile(t *testing.T) {
	keyring.MockInitWithError(errors.New("no keychain here"))
	var warn bytes.Buffer
	s := &SystemStore{FilePath: filepath.Join(t.TempDir(), "sub", "credentials.json"), Warn: &warn}
	if err := s.Save("dev", "secret"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(warn.String(), "no system keychain") || strings.Contains(warn.String(), "secret") {
		t.Fatalf("warning = %q", warn.String())
	}
	info, err := os.Stat(s.FilePath)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("file mode = %v, %v", info.Mode().Perm(), err)
	}
	if err := s.Save("dev", "rotated"); err != nil || strings.Count(warn.String(), "warning") != 1 {
		t.Fatalf("second Save: %v; warnings = %q", err, warn.String())
	}
	if got, err := s.Load("dev"); got != "rotated" || err != nil {
		t.Fatalf("Load = %q, %v", got, err)
	}
	if _, err := s.Load("other-device"); !errors.Is(err, ErrNoCredentials) {
		t.Fatalf("other device: %v", err)
	}
	if err := s.Delete("dev"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Load("dev"); !errors.Is(err, ErrNoCredentials) {
		t.Fatalf("after Delete: %v", err)
	}
}

func TestStorePrefersTheKeychain(t *testing.T) {
	keyring.MockInit()
	s := &SystemStore{FilePath: filepath.Join(t.TempDir(), "credentials.json")}
	// A file left from a time without a keychain must not outlive the keychain copy.
	if err := os.WriteFile(s.FilePath, []byte(`{"bilc_id":"dev","refresh_token":"old"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := s.Save("dev", "new"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s.FilePath); !os.IsNotExist(err) {
		t.Fatalf("stale file kept: %v", err)
	}
	if got, _ := s.Load("dev"); got != "new" {
		t.Fatalf("Load = %q", got)
	}
	if err := s.Delete("dev"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Load("dev"); !errors.Is(err, ErrNoCredentials) {
		t.Fatalf("after Delete: %v", err)
	}
}
