package auth

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sync/atomic"

	"github.com/zalando/go-keyring"
)

// ErrNoCredentials means nothing is stored for the device.
var ErrNoCredentials = errors.New("no stored credentials")

const keyringService = "chickenfaight-bilc"

// Store holds the device's refresh token. It is the only place a secret is kept.
type Store interface {
	Load(bilcID string) (string, error)
	Save(bilcID, refreshToken string) error
	Delete(bilcID string) error
}

// SystemStore uses the OS keychain. Without one, it falls back to a file
// readable only by this user, and warns once.
type SystemStore struct {
	FilePath string
	Warn     io.Writer

	warned atomic.Bool
}

type fileCredentials struct {
	BilcID       string `json:"bilc_id"`
	RefreshToken string `json:"refresh_token"`
}

func (s *SystemStore) Load(bilcID string) (string, error) {
	if token, err := keyring.Get(keyringService, bilcID); err == nil {
		return token, nil
	}
	data, err := os.ReadFile(s.FilePath)
	if errors.Is(err, fs.ErrNotExist) {
		return "", ErrNoCredentials
	}
	if err != nil {
		return "", fmt.Errorf("read credentials: %w", err)
	}
	var creds fileCredentials
	if err := json.Unmarshal(data, &creds); err != nil || creds.BilcID != bilcID || creds.RefreshToken == "" {
		return "", ErrNoCredentials
	}
	return creds.RefreshToken, nil
}

func (s *SystemStore) Save(bilcID, refreshToken string) error {
	keyringErr := keyring.Set(keyringService, bilcID, refreshToken)
	if keyringErr == nil {
		// A stale file copy must never outlive the keychain one.
		if err := os.Remove(s.FilePath); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("remove old credentials file: %w", err)
		}
		return nil
	}
	// Likewise, a stale keychain copy would be read first, so drop it.
	_ = keyring.Delete(keyringService, bilcID)
	if s.Warn != nil && !s.warned.Swap(true) {
		fmt.Fprintf(s.Warn, "warning: no system keychain (%v); storing credentials in %s, readable only by you\n", keyringErr, s.FilePath)
	}
	return writePrivate(s.FilePath, fileCredentials{BilcID: bilcID, RefreshToken: refreshToken})
}

func (s *SystemStore) Delete(bilcID string) error {
	// Not found, or no keychain at all, both mean nothing is stored there.
	_ = keyring.Delete(keyringService, bilcID)
	if err := os.Remove(s.FilePath); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("delete credentials: %w", err)
	}
	return nil
}

func writePrivate(path string, creds fileCredentials) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create config directory: %w", err)
	}
	data, err := json.Marshal(creds)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".credentials-*") // created with mode 0600
	if err != nil {
		return fmt.Errorf("write credentials: %w", err)
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("write credentials: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("write credentials: %w", err)
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return fmt.Errorf("write credentials: %w", err)
	}
	return nil
}
