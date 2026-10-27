package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMissingFileGivesDefaults(t *testing.T) {
	cfg, err := Load(filepath.Join(t.TempDir(), "config.json"), "http://server")
	if err != nil {
		t.Fatal(err)
	}
	if cfg != (Config{ServerURL: "http://server", Model: Model{BaseURL: DefaultModelURL}}) {
		t.Fatalf("defaults = %+v", cfg)
	}
}

func TestSaveAndLoad(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "config.json")
	want := Config{ServerURL: "https://api.example.com", Model: Model{BaseURL: "http://127.0.0.1:8080/v1", Name: "m"}, BilcID: "id"}
	if err := Save(path, want); err != nil {
		t.Fatal(err)
	}
	got, err := Load(path, "http://ignored")
	if err != nil || got != want {
		t.Fatalf("Load = %+v, %v", got, err)
	}
	if info, _ := os.Stat(path); info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %v", info.Mode().Perm())
	}
	if info, _ := os.Stat(filepath.Dir(path)); info.Mode().Perm() != 0o700 {
		t.Fatalf("dir mode = %v", info.Mode().Perm())
	}
}

func TestInvalidFileIsAnError(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	os.WriteFile(path, []byte("{"), 0o600)
	if _, err := Load(path, ""); err == nil {
		t.Fatal("expected an error")
	}
}

func TestIsLoopback(t *testing.T) {
	for raw, want := range map[string]bool{
		"http://localhost:11434/v1":  true,
		"http://127.0.0.1:11434/v1":  true,
		"http://127.8.0.1/":          true,
		"http://[::1]:8080":          true,
		"http://192.168.1.4:11434":   false,
		"https://models.example.com": false,
		"http://localhost.evil.com":  false,
	} {
		u, err := ParseHTTPURL(raw)
		if err != nil {
			t.Fatal(err)
		}
		if got := IsLoopback(u); got != want {
			t.Errorf("IsLoopback(%s) = %v", raw, got)
		}
	}
}

func TestParseHTTPURLRejectsOthers(t *testing.T) {
	for _, raw := range []string{"", "localhost:8000", "ftp://x", "http://", "file:///etc/passwd"} {
		if _, err := ParseHTTPURL(raw); err == nil {
			t.Errorf("ParseHTTPURL(%q) succeeded", raw)
		}
	}
}
