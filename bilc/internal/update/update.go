// Package update is BILC's UpdateManager: it asks the server for the latest
// release and compares it with the running version (BILC.md, "Updates").
package update

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// Status is how the running version compares with the server's release info.
type Status int

const (
	// Current: nothing to do. Also the answer for unversioned ("dev") builds.
	Current Status = iota
	// Available: a newer version exists, but this one still works.
	Available
	// Unsupported: below the minimum; the server would refuse this version.
	Unsupported
)

// Result is the outcome of a check.
type Result struct {
	Status  Status
	Latest  string
	Minimum string
}

// Check compares current with `GET {serverURL}/v1/bilc/releases/latest`. A
// failed request is an error; callers carry on without the answer.
func Check(ctx context.Context, client *http.Client, serverURL, current string) (Result, error) {
	running, ok := parse(current)
	if !ok {
		return Result{Status: Current}, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(serverURL, "/")+"/v1/bilc/releases/latest", nil)
	if err != nil {
		return Result{}, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return Result{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Result{}, fmt.Errorf("server returned HTTP %d", resp.StatusCode)
	}
	var release struct {
		Version             *string `json:"version"` // null until a release is published
		MinSupportedVersion string  `json:"min_supported_version"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&release); err != nil {
		return Result{}, fmt.Errorf("invalid release info: %w", err)
	}
	result := Result{Status: Current, Minimum: release.MinSupportedVersion}
	if minimum, ok := parse(release.MinSupportedVersion); ok && less(running, minimum) {
		result.Status = Unsupported
	}
	if release.Version != nil {
		result.Latest = *release.Version
		if latest, ok := parse(*release.Version); ok && less(running, latest) && result.Status == Current {
			result.Status = Available
		}
	}
	return result, nil
}

// parse reads MAJOR.MINOR.PATCH, with an optional leading v and suffix.
func parse(version string) ([3]int, bool) {
	version = strings.TrimPrefix(version, "v")
	if i := strings.IndexAny(version, "-+"); i >= 0 {
		version = version[:i]
	}
	parts := strings.Split(version, ".")
	if len(parts) != 3 {
		return [3]int{}, false
	}
	var out [3]int
	for i, part := range parts {
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 {
			return [3]int{}, false
		}
		out[i] = n
	}
	return out, true
}

func less(a, b [3]int) bool {
	for i := range a {
		if a[i] != b[i] {
			return a[i] < b[i]
		}
	}
	return false
}
