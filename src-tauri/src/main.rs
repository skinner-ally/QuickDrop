// Не показывать консоль в релизной сборке на Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    quickdrop_lib::run()
}
