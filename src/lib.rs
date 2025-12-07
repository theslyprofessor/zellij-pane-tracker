use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use zellij_tile::prelude::*;

#[derive(Default)]
struct State {
    pane_names: BTreeMap<String, String>,
    pane_commands: BTreeMap<String, String>,
    last_manifest: Option<PaneManifest>,
}

#[derive(Serialize, Deserialize)]
struct PaneNamesExport {
    panes: BTreeMap<String, String>,
    timestamp: u64,
}

#[derive(Serialize, Deserialize)]
struct PaneInfoExport {
    pane_id: String,
    name: String,
    command: Option<String>,
    is_focused: bool,
    is_floating: bool,
    coordinates: String,
}

register_plugin!(State);

impl ZellijPlugin for State {
    fn load(&mut self, _configuration: BTreeMap<String, String>) {
        // Subscribe to pane updates and key presses
        subscribe(&[
            EventType::PaneUpdate,
            EventType::Key,
        ]);
        
        // Request permissions
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
                self.auto_capture_panes(&pane_manifest);
                self.last_manifest = Some(pane_manifest);
                true
            }
            Event::Key(key) => {
                // Ctrl-g + c = Capture all panes manually
                if let Key::Char('c') = key {
                    if let Some(ref manifest) = self.last_manifest {
                        self.capture_all_panes(manifest);
                    }
                }
                false
            }
            _ => false,
        }
    }

    fn render(&mut self, _rows: usize, _cols: usize) {
        // Enhanced UI with more info
        println!("🔍 Pane Tracker Active");
        println!("═══════════════════════");
        println!("Tracking {} panes", self.pane_names.len());
        println!("");
        println!("Exports:");
        println!("  📋 Names: /tmp/zj-pane-names.json");
        println!("  📁 Content: /tmp/zj-pane-*.txt");
        println!("");
        println!("Keybindings:");
        println!("  Ctrl-g + c: Capture all panes");
        println!("");
        for (pane_id, name) in &self.pane_names {
            let cmd = self.pane_commands.get(pane_id)
                .map(|s| s.as_str())
                .unwrap_or("shell");
            println!("  {} → {} ({})", pane_id, name, cmd);
        }
    }
}

impl State {
    fn update_pane_info(&mut self, manifest: &PaneManifest) {
        self.pane_names.clear();
        self.pane_commands.clear();
        
        // manifest.panes is HashMap<usize, Vec<PaneInfo>>
        // Key is tab index, value is vector of panes in that tab
        for (_tab_index, panes_in_tab) in &manifest.panes {
            for pane_info in panes_in_tab {
                let pane_id = if pane_info.is_plugin {
                    format!("plugin_{}", pane_info.id)
                } else {
                    format!("terminal_{}", pane_info.id)
                };
                
                // Store pane name
                let pane_name = pane_info.title.clone();
                self.pane_names.insert(pane_id.clone(), pane_name);
                
                // Store running command if available
                if let Some(ref cmd) = pane_info.terminal_command {
                    self.pane_commands.insert(pane_id, cmd.clone());
                }
            }
        }
    }
    
    fn auto_capture_panes(&self, manifest: &PaneManifest) {
        // Auto-capture all panes whenever content updates
        for (_tab_index, panes_in_tab) in &manifest.panes {
            for pane_info in panes_in_tab {
                // Only capture terminal panes (not plugin panes)
                if !pane_info.is_plugin {
                    let pane_id = format!("terminal_{}", pane_info.id);
                    let pane_num = pane_info.id;
                    
                    // Dump pane content to numbered file
                    let dump_cmd = format!(
                        "zellij action dump-pane {} > /tmp/zj-pane-{}.txt 2>/dev/null || true",
                        pane_num, pane_num
                    );
                    
                    run_command(
                        &["sh", "-c", &dump_cmd],
                        BTreeMap::new(),
                    );
                    
                    // Also create named symlink if pane has custom name
                    if let Some(name) = self.pane_names.get(&pane_id) {
                        // Clean the name for filesystem use
                        let safe_name: String = name
                            .chars()
                            .map(|c| match c {
                                ' ' | '/' => '-',
                                c if c.is_alphanumeric() || c == '-' || c == '_' => c,
                                _ => '_',
                            })
                            .collect();
                        
                        // Don't create symlink for default "Pane #N" names
                        if !safe_name.starts_with("Pane-") {
                            let symlink_cmd = format!(
                                "ln -sf /tmp/zj-pane-{}.txt /tmp/zj-{}.txt 2>/dev/null || true",
                                pane_num, safe_name
                            );
                            
                            run_command(
                                &["sh", "-c", &symlink_cmd],
                                BTreeMap::new(),
                            );
                        }
                    }
                }
            }
        }
    }
    
    fn capture_all_panes(&self, manifest: &PaneManifest) {
        // Manual capture triggered by keybinding
        // Write a comprehensive capture with metadata
        let mut all_panes_info = Vec::new();
        
        for (_tab_index, panes_in_tab) in &manifest.panes {
            for pane_info in panes_in_tab {
                let pane_id = if pane_info.is_plugin {
                    format!("plugin_{}", pane_info.id)
                } else {
                    format!("terminal_{}", pane_info.id)
                };
                
                let info = PaneInfoExport {
                    pane_id: pane_id.clone(),
                    name: self.pane_names.get(&pane_id).cloned().unwrap_or_default(),
                    command: self.pane_commands.get(&pane_id).cloned(),
                    is_focused: pane_info.is_focused,
                    is_floating: pane_info.is_floating,
                    coordinates: format!("{}x{} at ({},{})", 
                        pane_info.pane_columns, pane_info.pane_rows,
                        pane_info.pane_x, pane_info.pane_y),
                };
                
                all_panes_info.push(info);
            }
        }
        
        // Write pane metadata to JSON
        if let Ok(json) = serde_json::to_string_pretty(&all_panes_info) {
            let meta_cmd = format!(
                "echo '{}' > /tmp/zj-panes-info.json",
                json.replace('\'', "'\"'\"'")
            );
            
            run_command(
                &["sh", "-c", &meta_cmd],
                BTreeMap::new(),
            );
        }
        
        // Trigger auto-capture
        self.auto_capture_panes(manifest);
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
