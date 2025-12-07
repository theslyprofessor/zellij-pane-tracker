# Enhanced zjall function that uses pane names from zellij-pane-tracker plugin
# Place this in ~/.config/zsh/conf.d/10-aliases.zsh to replace the existing zjall function

zjall() {
  if [[ -z "$ZELLIJ" ]]; then
    echo "Error: Not in a zellij session"
    return 1
  fi
  
  echo "📋 Capturing all panes..."
  
  # Use a unique marker: current pane's first 100 bytes + line count
  zellij action dump-screen /tmp/zj-ref.txt --full 2>/dev/null
  local ref_fingerprint="$(head -c 100 /tmp/zj-ref.txt)_$(wc -l < /tmp/zj-ref.txt)"
  
  # Load pane names mapping if available
  local -A pane_names
  if [[ -f /tmp/zj-pane-names.json ]]; then
    # Parse JSON to get pane names (requires jq)
    if command -v jq &> /dev/null; then
      while IFS="=" read -r pane_id pane_name; do
        pane_names[$pane_id]="$pane_name"
      done < <(jq -r '.panes | to_entries[] | "\(.key)=\(.value)"' /tmp/zj-pane-names.json 2>/dev/null)
    fi
  fi
  
  # Get current pane ID from environment
  local current_pane_id="${ZELLIJ_PANE_ID:-terminal_1}"
  
  # Save pane 1
  cp /tmp/zj-ref.txt /tmp/zj-pane-1.txt
  
  # Create named symlink if pane has custom name
  if [[ -n "${pane_names[$current_pane_id]}" ]]; then
    local safe_name=$(echo "${pane_names[$current_pane_id]}" | tr ' /' '-' | tr -cd '[:alnum:]-_')
    if [[ "$safe_name" != "Pane-#1" && -n "$safe_name" ]]; then
      ln -sf /tmp/zj-pane-1.txt "/tmp/zj-${safe_name}.txt"
      echo "  📝 Pane 1: ${pane_names[$current_pane_id]} → /tmp/zj-${safe_name}.txt"
    fi
  fi
  
  local count=1
  
  # Cycle through panes
  while true; do
    zellij action focus-next-pane
    sleep 0.2
    
    count=$((count + 1))
    zellij action dump-screen /tmp/zj-pane-${count}.txt --full 2>/dev/null
    
    # Try to get the pane ID for this pane (we'll use heuristics)
    # Note: We don't have direct access to the new pane's ID after switching
    # So we'll create the numbered file and check if a name exists in the mapping
    local pane_file="/tmp/zj-pane-${count}.txt"
    
    # Create fingerprint for comparison
    local curr_fingerprint="$(head -c 100 $pane_file)_$(wc -l < $pane_file)"
    
    # Check if we wrapped around (back to original pane)
    if [[ "$curr_fingerprint" == "$ref_fingerprint" ]]; then
      rm $pane_file
      count=$((count - 1))
      break
    fi
    
    # Try to find a named pane by checking the file content for ZELLIJ_PANE_ID
    # This is a heuristic - look for pane ID in captured output
    if command -v rg &> /dev/null; then
      local detected_id=$(rg -o 'terminal_[0-9]+' $pane_file 2>/dev/null | head -1)
      if [[ -n "$detected_id" && -n "${pane_names[$detected_id]}" ]]; then
        local safe_name=$(echo "${pane_names[$detected_id]}" | tr ' /' '-' | tr -cd '[:alnum:]-_')
        if [[ "$safe_name" != "Pane-#${count}" && -n "$safe_name" ]]; then
          ln -sf $pane_file "/tmp/zj-${safe_name}.txt"
          echo "  📝 Pane ${count}: ${pane_names[$detected_id]} → /tmp/zj-${safe_name}.txt"
        fi
      fi
    fi
    
    # Safety: max 20 panes
    if [[ $count -ge 20 ]]; then
      echo "⚠️  Safety limit reached (20 panes)"
      break
    fi
  done
  
  # Return to original pane
  zellij action focus-next-pane
  
  echo ""
  echo "✅ Captured $count panes:"
  echo "  📁 /tmp/zj-pane-{1..$count}.txt"
  if [[ ${#pane_names[@]} -gt 0 ]]; then
    echo "  🏷️  Named panes: /tmp/zj-*.txt (symlinks)"
  else
    echo ""
    echo "💡 Tip: Run zellij-pane-tracker plugin for automatic pane name detection"
    echo "   Or use 'zjlabel <name>' to manually name the current pane"
  fi
}
