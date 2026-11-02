package update

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func server(t *testing.T, status int, body string) (string, *int) {
	t.Helper()
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodGet || r.URL.Path != "/v1/bilc/releases/latest" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(status)
		fmt.Fprint(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv.URL, &calls
}

func release(version, minimum string) string {
	return fmt.Sprintf(`{"version":%s,"min_supported_version":%q,"protocol_version":1,"assets":[]}`, version, minimum)
}

func TestCheck(t *testing.T) {
	for name, tc := range map[string]struct {
		current, version, minimum string
		want                      Status
	}{
		"up to date":          {"0.2.0", `"0.2.0"`, "0.1.0", Current},
		"newer than latest":   {"0.3.0", `"0.2.0"`, "0.1.0", Current},
		"update available":    {"0.1.0", `"0.2.0"`, "0.1.0", Available},
		"compares as numbers": {"0.9.0", `"0.10.0"`, "0.1.0", Available},
		"below the minimum":   {"0.0.9", `"0.2.0"`, "0.1.0", Unsupported},
		"no release yet":      {"0.1.0", `null`, "0.1.0", Current},
		"no release, too old": {"0.0.9", `null`, "0.1.0", Unsupported},
		"prerelease of same":  {"0.2.0-rc.1", `"0.2.0"`, "0.1.0", Current},
		"leading v":           {"v0.1.0", `"0.2.0"`, "0.1.0", Available},
		"unreadable latest":   {"0.1.0", `"newest"`, "0.1.0", Current},
		"unreadable minimum":  {"0.1.0", `"0.1.0"`, "whatever", Current},
	} {
		t.Run(name, func(t *testing.T) {
			url, _ := server(t, 200, release(tc.version, tc.minimum))
			got, err := Check(context.Background(), http.DefaultClient, url, tc.current)
			if err != nil || got.Status != tc.want {
				t.Fatalf("Check = %+v, %v; want status %d", got, err, tc.want)
			}
		})
	}
}

func TestResultCarriesTheVersions(t *testing.T) {
	url, _ := server(t, 200, release(`"0.2.0"`, "0.1.0"))
	got, err := Check(context.Background(), http.DefaultClient, url, "0.1.0")
	if err != nil || got.Latest != "0.2.0" || got.Minimum != "0.1.0" {
		t.Fatalf("Check = %+v, %v", got, err)
	}
}

func TestDevBuildsSkipTheCheck(t *testing.T) {
	url, calls := server(t, 200, release(`"0.2.0"`, "0.1.0"))
	got, err := Check(context.Background(), http.DefaultClient, url, "dev")
	if err != nil || got.Status != Current || *calls != 0 {
		t.Fatalf("Check = %+v, %v after %d calls", got, err, *calls)
	}
}

func TestFailuresAreErrors(t *testing.T) {
	for name, tc := range map[string]struct {
		status int
		body   string
	}{
		"older server without the route": {404, `{"detail":"Not Found"}`},
		"server error":                   {500, ``},
		"not json":                       {200, `<html>`},
	} {
		t.Run(name, func(t *testing.T) {
			url, _ := server(t, tc.status, tc.body)
			if _, err := Check(context.Background(), http.DefaultClient, url, "0.1.0"); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
	if _, err := Check(context.Background(), http.DefaultClient, "http://127.0.0.1:1", "0.1.0"); err == nil {
		t.Fatal("expected an error for an unreachable server")
	}
}
