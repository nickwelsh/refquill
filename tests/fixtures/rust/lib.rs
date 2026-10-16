//! Compiler-backed Rust documentation fixture.
#![allow(dead_code)]

/// A named value with an associated implementation.
pub struct Record<'a, T: Clone = String> {
    /// The value.
    pub value: T,
    pub label: &'a str,
    hidden: bool,
}

impl<'a, T: Clone> Record<'a, T> {
    /// Make a record. See [`Record`].
    pub const fn new(value: T, label: &'a str) -> Self {
        Self { value, label, hidden: false }
    }
}
impl<'a, T: Clone> Record<'a, T> {
    pub fn label(&self) -> &'a str { self.label }
}

/// A computation contract.
pub trait Compute<T>: Send where T: Clone {
    type Output: Clone;
    const ENABLED: bool = true;
    fn compute(&self, input: T) -> Self::Output;
    fn enabled(&self) -> bool { Self::ENABLED }
}

impl<'a, T: Clone + Send> Compute<T> for Record<'a, T> {
    type Output = T;
    const ENABLED: bool = false;
    fn compute(&self, input: T) -> T { input }
}

pub enum Status {
    Ready,
    Failed { code: u32 },
    Message(String),
}

pub union Bits { pub integer: u32, pub float: f32 }
pub type Callback = for<'a> unsafe extern "C" fn(&'a str, ...) -> i32;
pub type SystemCallback = extern "system" fn();
#[allow(non_camel_case_types)]
pub struct r#struct { pub r#loop: u32 }
pub fn r#type(r#match: u32) -> r#struct { r#struct { r#loop: r#match } }
pub const LIMIT: usize = 3;
pub static NAME: &str = "fixture";
pub async unsafe fn inspect<const N: usize>(values: [u8; N]) -> Result<(), &'static str> { Ok(()) }
pub fn divergent(pointer: *const u8) -> ! { loop {} }
pub fn tuples(unit: (), single: (u8,), slice: &[u8]) {}
pub fn dynamic(value: &(dyn std::fmt::Debug + Send)) {}
pub fn callback<F: for<'a> Fn(&'a str) -> u32>(callback: F) {}
pub fn iterator() -> impl Iterator<Item = u32> + use<> { None.into_iter() }
pub fn consume(value: impl Clone) {}
unsafe extern "C" {
    pub fn foreign_function(value: i32) -> i32;
    pub static FOREIGN_STATIC: u32;
}
pub trait Lending {
    type Item<'b>: 'b where Self: 'b;
}
pub trait ExternalReceiver { fn receiver(&self); }
impl ExternalReceiver for String { fn receiver(&self) {} }

mod private_module { pub struct Original; }
pub use private_module::Original as Exposed;
mod glob_private { pub struct GlobExport; }
pub use glob_private::*;

pub mod nested {
    pub struct Inner(pub u32);
}
pub mod excluded;
pub use nested::Inner as Renamed;
pub use nested::*;

#[macro_export]
macro_rules! example { () => { 1 }; }

#[deprecated(since = "1.0", note = "Use Record")]
pub fn old() {}

struct Private;
#[doc(hidden)]
pub struct Hidden;

#[cfg(feature = "extra")]
pub struct Extra;
