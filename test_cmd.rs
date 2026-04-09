use std::process::Command;
fn main() {
    let cmd = "command -v node";
    let full_cmd = format!(
        "export PATH=\"/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH\"; \
         export NVM_DIR=\"$HOME/.nvm\"; \
         [ -s \"$NVM_DIR/nvm.sh\" ] && . \"$NVM_DIR/nvm.sh\"; \
         {}",
        cmd
    );
    let output = Command::new("/bin/zsh").args(&["-l", "-c"]).arg(&full_cmd).output().unwrap();
    println!("Status: {}", output.status);
    println!("STDOUT: {}", String::from_utf8_lossy(&output.stdout));
    println!("STDERR: {}", String::from_utf8_lossy(&output.stderr));
}
