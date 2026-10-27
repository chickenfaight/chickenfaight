// Package config loads and saves BILC's config file. It never holds secrets;
// the refresh token lives in the credential store (internal/auth).
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/url"
	"os"
	"path/filepath"
)

// DefaultModelURL is local Ollama's OpenAI-compatible endpoint.
const DefaultModelURL = "http://127.0.0.1:11434/v1"

type Model struct {
	BaseURL string `json:"base_url"`
	Name    string `json:"name"`
}

type Config struct {
	ServerURL string `json:"server_url"`
	Model     Model  `json:"model"`
	BilcID    string `json:"bilc_id,omitempty"`
}

// Dir is os.UserConfigDir()/chickenfaight/bilc.
func Dir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("find config directory: %w", err)
	}
	return filepath.Join(base, "chickenfaight", "bilc"), nil
}

// Load reads the config at path. A missing file gives defaults, with
// serverURL as the server.
func Load(path, serverURL string) (Config, error) {
	cfg := Config{ServerURL: serverURL, Model: Model{BaseURL: DefaultModelURL}}
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return cfg, nil
	}
	if err != nil {
		return Config{}, fmt.Errorf("read config: %w", err)
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}, fmt.Errorf("config %s is not valid JSON: %w", path, err)
	}
	return cfg, nil
}

// Save writes the config atomically, readable only by this user.
func Save(path string, cfg Config) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create config directory: %w", err)
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".config-*.json")
	if err != nil {
		return fmt.Errorf("write config: %w", err)
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(append(data, '\n')); err != nil {
		tmp.Close()
		return fmt.Errorf("write config: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("write config: %w", err)
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return fmt.Errorf("write config: %w", err)
	}
	return nil
}

// ParseHTTPURL accepts only absolute http(s) URLs with a host.
func ParseHTTPURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("%q is not an http:// or https:// URL", raw)
	}
	return u, nil
}

// IsLoopback reports whether the URL's host is this machine.
func IsLoopback(u *url.URL) bool {
	host := u.Hostname()
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
