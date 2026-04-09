use std::process::Command;
fn main() {
    let output = Command::new("/bin/zsh").args(&["-l", "-c"]).arg("echo $HOME").output().unwrap();
    println!("HOME: {}", String::from_utf8_lossy(&output.stdout));
}
