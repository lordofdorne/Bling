package social

import (
	"strings"
	"testing"
)

func TestProfileValidation(t *testing.T) {
	valid := ProfileInput{DisplayName: "Creator", Category: "Music", AvatarURL: "https://example.com/avatar.png", Published: true}
	if err := valid.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, url := range []string{"javascript:alert(1)", "http://example.com/a", "https://user:secret@example.com/a", "//example.com/a"} {
		p := valid
		p.AvatarURL = url
		if p.Validate() == nil {
			t.Errorf("accepted unsafe URL %s", url)
		}
	}
	p := valid
	p.DisplayName = strings.Repeat("a", 61)
	if p.Validate() == nil {
		t.Fatal("oversize name accepted")
	}
	p = valid
	p.Category = "unknown"
	if p.Validate() == nil {
		t.Fatal("unknown category accepted")
	}
}
func TestDirectoryCursorValidation(t *testing.T) {
	o := ListOptions{Category: "Music", Limit: 2}
	if err := o.Validate(); err != nil {
		t.Fatal(err)
	}
	o.Cursor = encodeCursor(directoryCursor{true, 42, "00000000-0000-4000-8000-000000000001", o.scope()})
	if err := o.Validate(); err != nil {
		t.Fatal(err)
	}
	o.Category = "Tech"
	if o.Validate() == nil {
		t.Fatal("cross-filter cursor accepted")
	}
	for _, limit := range []int{-1, 51} {
		o := ListOptions{Limit: limit}
		if o.Validate() == nil {
			t.Fatal("unbounded page accepted")
		}
	}
	o = ListOptions{Cursor: strings.Repeat("a", 1000)}
	if o.Validate() == nil {
		t.Fatal("oversized cursor accepted")
	}
}
