//go:build unix

package config

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadRejectsUnsafeConfigPath(t *testing.T) {
	for _, test := range []struct {
		name string
		mode fs.FileMode
		path func(file, dir, parent string) string
	}{
		{"writable file", 0o662, func(file, _, _ string) string { return file }},
		{"writable config directory", 0o770, func(_, dir, _ string) string { return dir }},
		{"writable parent directory", 0o777, func(_, _, parent string) string { return parent }},
	} {
		t.Run(test.name, func(t *testing.T) {
			parent := t.TempDir()
			dir := filepath.Join(parent, "device")
			file := filepath.Join(dir, "config.json")
			if err := Save(file, Config{ServerURL: "https://example.invalid"}); err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(test.path(file, dir, parent), test.mode); err != nil {
				t.Fatal(err)
			}
			if _, err := Load(file, ""); err == nil || !strings.Contains(err.Error(), "unsafe config") {
				t.Fatalf("Load error = %v, want an unsafe config error", err)
			}
		})
	}
}

func TestLoadRejectsSymlinkedConfig(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "config.json")
	target := filepath.Join(dir, "other.json")
	if err := Save(target, Config{ServerURL: "https://example.invalid"}); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, file); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(file, ""); err == nil || !strings.Contains(err.Error(), "unsafe config file") {
		t.Fatalf("Load error = %v, want an unsafe config file error", err)
	}
}

func TestLoadAllowsPrivateConfigUnderStickyParent(t *testing.T) {
	parent := t.TempDir()
	if err := os.Chmod(parent, os.ModeSticky|0o777); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(parent, "device", "config.json")
	want := Config{ServerURL: "https://example.invalid", Model: Model{BaseURL: DefaultModelURL}}
	if err := Save(file, want); err != nil {
		t.Fatal(err)
	}
	if got, err := Load(file, ""); err != nil || got != want {
		t.Fatalf("Load = %+v, %v", got, err)
	}
}
