use litesvm::LiteSVM;

/// The built program loads into a fresh SVM under its declared id.
#[test]
fn program_loads_under_declared_id() {
    let program_id = clamp::id();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/clamp.so"));
    let mut svm = LiteSVM::new();
    svm.add_program(program_id, bytes).unwrap();

    let account = svm
        .get_account(&program_id)
        .expect("program account exists");
    assert!(account.executable);
}
