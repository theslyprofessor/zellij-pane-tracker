use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use zellij_tile::prelude::*;

#[derive(Default)]
struct State {
    pane_names: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize)]
struct PaneNamesExport {
    panes: BTreeMap<String, String>,
    timestamp: u64,
}

register_plugin!(State);

impl ZellijPlugin for State {
    fn load(&mut self, _configuration: BTreeMap<String, String>) {
        // Subscribe to pane updates to track name changes
        subscribe(&[EventType::PaneUpdate]);
        
        // Request permissions
        request_permission(&[
            PermissionType::ReadApplicationState,
            PermissionType::RunCommands,
        ]);
    }

    fn update(&mut self, event: Event) -> bool {
        match event {
            Event::PaneUpdate(pane_manifest) => {
                self.update_pane_names(pane_manifest);
                self.export_to_file();
                true
            }
            _ => false,
        }
    }

    fn render(&mut self, _rows: usize, _cols: usize) {
        // Minimal UI - just show status
        println!("🔍 Pane Tracker Active");
        println!("Tracking {} panes", self.pane_names.len());
        println!("Export: /tmp/zj-pane-names.json");
    }
}

impl State {
    fn update_pane_names(&mut self, manifest: PaneManifest) {
        self.pane_names.clear();
        
        // manifest.panes is HashMap<usize, Vec<PaneInfo>>
        // Key is tab index, value is vector of panes in that tab
        for (_tab_index, panes_in_tab) in &manifest.panes {
            for pane_info in panes_in_tab {
                let pane_id = if pane_info.is_plugin {
                    format!("plugin_{}", pane_info.id)
                } else {
                    format!("terminal_{}", pane_info.id)
                };
                
                // Use the pane title (which includes user-set names)
                let pane_name = pane_info.title.clone();
                
                self.pane_names.insert(pane_id, pane_name);
            }
        }
    }

    fn export_to_file(&self) {
        let export = PaneNamesExport {
            panes: self.pane_names.clone(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        };

        if let Ok(json) = serde_json::to_string_pretty(&export) {
            // Write to /tmp/zj-pane-names.json
            // Note: In WASM, we need to use the plugin host API for file writes
            // For now, we'll use the host_run_command permission to write via shell
            let write_cmd = format!(
                "echo '{}' > /tmp/zj-pane-names.json",
                json.replace('\'', "'\"'\"'")
            );
            
            run_command(
                &["sh", "-c", &write_cmd],
                BTreeMap::new(),
            );
        }
    }
}
