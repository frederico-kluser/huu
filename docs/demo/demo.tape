# HUU End-to-End Demo
# Requires: VHS (https://github.com/charmbracelet/vhs)
# Generate: vhs docs/demo/demo.tape

Output docs/demo/huu-e2e.gif
Set Shell "bash"
Set FontSize 14
Set Width 1200
Set Height 700
Set Padding 20
Set Theme "Dracula"

# Title
Type "# HUU — Multi-agent orchestrator for software development"
Enter
Sleep 1s

# Show help
Type "huu --help"
Enter
Sleep 2s

# Initialize in a project
Type "huu init --yes"
Enter
Sleep 2s

# Show status
Type "huu status"
Enter
Sleep 2s

# Run a single task
Type 'huu run "Add a utility function that formats dates as ISO strings"'
Enter
Sleep 5s

# Show result
Type "huu status"
Enter
Sleep 2s

# Show git log
Type "git log --oneline -5"
Enter
Sleep 2s

# Outro
Type "# Done! See README.md for more."
Enter
Sleep 2s
