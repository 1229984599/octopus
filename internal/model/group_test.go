package model

import (
	"encoding/json"
	"testing"
)

func TestGroupUnmarshalAutoCheckDefaultsToTrue(t *testing.T) {
	var group Group
	if err := json.Unmarshal([]byte(`{"id":1,"name":"test","mode":1}`), &group); err != nil {
		t.Fatal(err)
	}
	if !group.AutoCheck {
		t.Fatal("expected auto_check to default to true when missing")
	}
}

func TestGroupUnmarshalAutoCheckPreservesFalse(t *testing.T) {
	var group Group
	if err := json.Unmarshal([]byte(`{"id":1,"name":"test","mode":1,"auto_check":false}`), &group); err != nil {
		t.Fatal(err)
	}
	if group.AutoCheck {
		t.Fatal("expected explicit auto_check=false to be preserved")
	}
}
