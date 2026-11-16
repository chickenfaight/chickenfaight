package tests

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
)

func archive(t *testing.T, version string) []byte {
	t.Helper()
	var data bytes.Buffer
	gz := gzip.NewWriter(&data)
	tw := tar.NewWriter(gz)
	body := []byte("#!/bin/sh\necho 'bilc " + version + "'\n")
	if err := tw.WriteHeader(&tar.Header{Name: "bilc", Mode: 0755, Size: int64(len(body))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write(body); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func TestInstallerPreservesExistingBinaryOnVerificationAndExtractionFailure(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX installer; Windows uses release zip")
	}
	asset := fmt.Sprintf("bilc_%s_%s.tar.gz", runtime.GOOS, runtime.GOARCH)
	data := archive(t, "0.2.0")
	checksum := fmt.Sprintf("%x  %s\n", sha256.Sum256(data), asset)
	var mu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.URL.Path == "/checksums.txt" {
			fmt.Fprint(w, checksum)
		} else {
			w.Write(data)
		}
	}))
	defer srv.Close()
	dir := t.TempDir()
	installed := filepath.Join(dir, "bilc")
	run := func(wantSuccess bool) string {
		t.Helper()
		cmd := exec.Command("sh", "../install.sh")
		cmd.Env = append(os.Environ(), "BILC_DOWNLOAD_URL="+srv.URL, "BILC_INSTALL_DIR="+dir)
		out, err := cmd.CombinedOutput()
		if (err == nil) != wantSuccess {
			t.Fatalf("install err=%v output=%s", err, out)
		}
		return string(out)
	}
	run(true)
	if !strings.Contains(run(true), "already installed") {
		t.Fatal("repeat install did not detect version")
	}
	mu.Lock()
	data = archive(t, "0.3.0")
	checksum = fmt.Sprintf("%x  %s\n", sha256.Sum256(data), asset)
	mu.Unlock()
	if !strings.Contains(run(true), "Updated bilc 0.2.0 to bilc 0.3.0") {
		t.Fatal("upgrade was not reported")
	}
	original, err := os.ReadFile(installed)
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"checksum", "truncated", "missing-checksum"} {
		t.Run(kind, func(t *testing.T) {
			mu.Lock()
			data = []byte("truncated archive")
			switch kind {
			case "checksum":
				checksum = fmt.Sprintf("%064d  %s\n", 0, asset)
			case "truncated":
				checksum = fmt.Sprintf("%x  %s\n", sha256.Sum256(data), asset)
			case "missing-checksum":
				checksum = ""
			}
			mu.Unlock()
			run(false)
			got, err := os.ReadFile(installed)
			if err != nil || !bytes.Equal(got, original) {
				t.Fatal("failed install modified existing binary")
			}
			entries, _ := os.ReadDir(dir)
			if len(entries) != 1 {
				t.Fatalf("left temporary files: %v", entries)
			}
		})
	}
}
