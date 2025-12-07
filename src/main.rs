use serde::Serialize;
use std::collections::BTreeMap;
use zellij_tile::prelude::*;

/// Plugin state - tracks pane names and commands across all tabs
#[derive(Default)]
struct State {
    pane_names: BTreeMap<String, String>,
    pane_commands: BTreeMap<String, String>,
}

/// JSON export format for pane metadata
#[derive(Serialize)]
struct PaneNamesExport {
    panes: BTreeMap<String, String>,
    timestamp: u64,
}

register_plugin!(State);

impl ZellijPlugin for State {
    fn load(&mut self, _configuration: BTreeMap<String, String>) {
        subscribe(&[EventType::PaneUpdate]);
        
        request_permission(&[
            PermissionType::ReadApplicationState,
            PermissionType::RunCommands,
        ]);
    }

    fn update(&mut self, event: Event) -> bool {
        match event {
            Event::PaneUpdate(pane_manifest) => {
                self.update_pane_info(&pane_manifest);
                self.export_to_file();
                true
            }
            _ => false,
        }
    }

    fn render(&mut self, _rows: usize, _cols: usize) {
        println!("Pane Tracker");
        println!("============");
        println!("Tracking {} panes", self.pane_names.len());
        println!();
        println!("Export: /tmp/zj-pane-names.json");
        println!();
        println!("Panes:");
        for (pane_id, name) in &self.pane_names {
            let cmd = self.pane_commands.get(pane_id)
                .map(|s| s.as_str())
                .unwrap_or("-");
            println!("  {} -> {} ({})", pane_id, name, cmd);
        }
    }
}

impl State {
    /// Extract pane information from the manifest
    fn update_pane_info(&mut self, manifest: &PaneManifest) {
        self.pane_names.clear();
        self.pane_commands.clear();
        
        for (_tab_index, panes_in_tab) in &manifest.panes {
            for pane_info in panes_in_tab {
                let pane_id = if pane_info.is_plugin {
                    format!("plugin_{}", pane_info.id)
                } else {
                    format!("terminal_{}", pane_info.id)
                };
                
                self.pane_names.insert(pane_id.clone(), pane_info.title.clone());
                
                if let Some(ref cmd) = pane_info.terminal_command {
                    self.pane_commands.insert(pane_id, cmd.clone());
                }
            }
        }
    }

    /// Export pane metadata to JSON file
    fn export_to_file(&self) {
        let export = PaneNamesExport {
            panes: self.pane_names.clone(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        };

        if let Ok(json) = serde_json::to_string_pretty(&export) {
            let escaped = json
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('$', "\\$")
                .replace('`', "\\`");
            
            run_command(
                &["sh", "-c", &format!("printf '%s' \"{}\" > /tmp/zj-pane-names.json", escaped)],
                BTreeMap::new(),
            );
        }
    }
}
