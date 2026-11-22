package codex

import (
	"context"
	"encoding/json"

	"github.com/chldu2000/aibo/internal/agent"
)

// What a thread runs with, besides its messages: the permission presets
// (/permissions), the models, and what a thread says it uses.

// preset is what one of /permissions' presets sets.
type preset struct {
	mode                      agent.PermissionMode
	sandbox, policy, reviewer string
}

// presets are Codex's /permissions, in its order (research/11): Ask for
// approval is what aibo always set before ADR 0003, its default.
var presets = []preset{
	{agent.PermissionMode{ID: "read-only", Name: "Read only", Description: "只读：不改文件，要改时先问", Risk: agent.Safe, ReadOnly: true},
		"read-only", "on-request", "user"},
	{agent.PermissionMode{ID: "ask-for-approval", Name: "Ask for approval", Description: "工作区内的修改和命令不问；工作区以外、联网时先问", Risk: agent.Safe, Default: true},
		"workspace-write", "on-request", "user"},
	{agent.PermissionMode{ID: "approve-for-me", Name: "Approve for me", Description: "要问的操作由模型代为审批", Risk: agent.Caution},
		"workspace-write", "on-request", "auto_review"},
	{agent.PermissionMode{ID: "full-access", Name: "Full access", Description: "所有操作都不再询问，包括工作区以外", Risk: agent.Danger},
		"danger-full-access", "never", "user"},
}

// defaultPreset is the one a thread without a mode starts in.
const defaultPreset = "ask-for-approval"

func presetOf(id string) (preset, bool) {
	for _, p := range presets {
		if p.mode.ID == id {
			return p, true
		}
	}
	return preset{}, false
}

// sandboxTypes are turn/start's sandbox policy types for thread/start's
// sandbox modes.
var sandboxTypes = map[string]string{"read-only": "readOnly", "workspace-write": "workspaceWrite", "danger-full-access": "dangerFullAccess"}

// modeOf is the preset a thread's settings are, as thread/start,
// thread/resume and thread/settings/updated say them; "" for none.
func modeOf(policy, reviewer, sandboxType string) string {
	for _, p := range presets {
		if p.policy == policy && p.reviewer == reviewer && sandboxTypes[p.sandbox] == sandboxType {
			return p.mode.ID
		}
	}
	return ""
}

// reviewerFlag is the feature Approve for me needs.
const reviewerFlag = "guardian_approval"

// PermissionModes are Codex's presets; Approve for me is unavailable
// while its feature is off.
func (a *Agent) PermissionModes(ctx context.Context) ([]agent.PermissionMode, error) {
	var out []agent.PermissionMode
	for _, p := range presets {
		out = append(out, p.mode)
	}
	srv, err := a.server(ctx)
	if err != nil {
		return out, nil // the presets still are; the flag is unknown
	}
	var res struct {
		Data []struct {
			Name    string `json:"name"`
			Enabled bool   `json:"enabled"`
		} `json:"data"`
	}
	if srv.call(ctx, "experimentalFeature/list", map[string]any{}, &res) != nil {
		return out, nil
	}
	for _, f := range res.Data {
		if f.Name == reviewerFlag && !f.Enabled {
			for i := range out {
				if out[i].ID == "approve-for-me" {
					out[i].Unavailable = "Codex 没有开启自动审批（feature " + reviewerFlag + "）"
				}
			}
		}
	}
	return out, nil
}

// threadSettings is what a thread uses, as thread/start and thread/resume
// answer: Codex's own defaults, and the user's config, included.
func threadSettings(result json.RawMessage) agent.SettingsReported {
	var r struct {
		Model  string `json:"model"`
		Effort string `json:"reasoningEffort"`
	}
	json.Unmarshal(result, &r)
	return agent.SettingsReported{Model: r.Model, Effort: r.Effort}
}

// threadMode is the preset of a thread, as thread/start and thread/resume
// answer; "" when its settings are none of them.
func threadMode(result json.RawMessage) string {
	var r struct {
		Policy   string `json:"approvalPolicy"`
		Reviewer string `json:"approvalsReviewer"`
		Sandbox  struct {
			Type string `json:"type"`
		} `json:"sandbox"`
	}
	json.Unmarshal(result, &r)
	return modeOf(r.Policy, r.Reviewer, r.Sandbox.Type)
}

// Models asks the app-server which models Codex offers (model/list), its
// default first.
func (a *Agent) Models(ctx context.Context) ([]agent.Model, error) {
	srv, err := a.server(ctx)
	if err != nil {
		return nil, err
	}
	var res json.RawMessage
	if err := srv.call(ctx, "model/list", map[string]any{}, &res); err != nil {
		return nil, err
	}
	return listModels(res)
}

// listModels reads model/list's result. Each model keeps its own ID, the
// default's too, which turn/start can ask for again; the user's config
// may run another (SettingsReported says).
func listModels(result json.RawMessage) ([]agent.Model, error) {
	var res struct {
		Data []struct {
			ID            string `json:"id"`
			DisplayName   string `json:"displayName"`
			Description   string `json:"description"`
			Hidden        bool   `json:"hidden"`
			IsDefault     bool   `json:"isDefault"`
			DefaultEffort string `json:"defaultReasoningEffort"`
			Efforts       []struct {
				Effort string `json:"reasoningEffort"`
			} `json:"supportedReasoningEfforts"`
		} `json:"data"`
	}
	if err := json.Unmarshal(result, &res); err != nil {
		return nil, err
	}
	var out []agent.Model
	for _, m := range res.Data {
		if m.Hidden {
			continue
		}
		x := agent.Model{ID: m.ID, Name: m.DisplayName, Description: m.Description, DefaultEffort: m.DefaultEffort}
		for _, e := range m.Efforts {
			x.Efforts = append(x.Efforts, e.Effort)
		}
		if m.IsDefault {
			out = append([]agent.Model{x}, out...)
		} else {
			out = append(out, x)
		}
	}
	return out, nil
}
