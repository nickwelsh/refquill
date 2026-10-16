use mago_phpdoc_syntax::cst::r#type::{GenericParameters, ReferenceKind, Type};
use mago_span::{HasSpan, Span};

/// Walk actual reference nodes, never identifier-shaped strings, shape keys,
/// literal values, or callable parameter names.
pub fn references(ty: &Type<'_>) -> Vec<(Span, String)> {
    let mut result = vec![];
    visit(ty, &mut result);
    result
}
fn reference(kind: &ReferenceKind<'_>, names: &mut Vec<(Span, String)>) {
    names.push((kind.span(), kind.to_string()));
}
fn generics(parameters: &GenericParameters<'_>, names: &mut Vec<(Span, String)>) {
    for entry in &parameters.entries {
        visit(&entry.inner, names);
    }
}
fn optional_generics(parameters: &Option<GenericParameters<'_>>, names: &mut Vec<(Span, String)>) {
    if let Some(parameters) = parameters {
        generics(parameters, names);
    }
}
fn visit(ty: &Type<'_>, names: &mut Vec<(Span, String)>) {
    match ty {
        Type::Reference(t) => {
            reference(&t.kind, names);
            optional_generics(&t.parameters, names);
        }
        Type::MemberReference(t) => reference(&t.kind, names),
        Type::AliasReference(t) => reference(&t.class, names),
        Type::Parenthesized(t) => visit(t.inner, names),
        Type::Union(t) => {
            visit(t.left, names);
            visit(t.right, names);
        }
        Type::Intersection(t) => {
            visit(t.left, names);
            visit(t.right, names);
        }
        Type::Nullable(t) => visit(t.inner, names),
        Type::TrailingPipe(t) => visit(t.inner, names),
        Type::Array(t) => optional_generics(&t.parameters, names),
        Type::NonEmptyArray(t) => optional_generics(&t.parameters, names),
        Type::AssociativeArray(t) => optional_generics(&t.parameters, names),
        Type::List(t) => optional_generics(&t.parameters, names),
        Type::NonEmptyList(t) => optional_generics(&t.parameters, names),
        Type::Iterable(t) => optional_generics(&t.parameters, names),
        Type::ClassString(t) => {
            if let Some(p) = &t.parameter {
                visit(&p.entry.inner, names);
            }
        }
        Type::ClassLikeString(t) => {
            if let Some(p) = &t.parameter {
                visit(&p.entry.inner, names);
            }
        }
        Type::InterfaceString(t) => {
            if let Some(p) = &t.parameter {
                visit(&p.entry.inner, names);
            }
        }
        Type::EnumString(t) => {
            if let Some(p) = &t.parameter {
                visit(&p.entry.inner, names);
            }
        }
        Type::TraitString(t) => {
            if let Some(p) = &t.parameter {
                visit(&p.entry.inner, names);
            }
        }
        Type::Shape(t) => {
            for field in &t.fields {
                visit(field.value, names);
            }
            if let Some(fields) = &t.additional_fields {
                optional_generics(&fields.parameters, names);
            }
        }
        Type::Object(t) => {
            if let Some(properties) = &t.properties {
                for field in &properties.fields {
                    visit(field.value, names);
                }
            }
        }
        Type::Callable(t) => {
            if let Some(spec) = &t.specification {
                for p in &spec.parameters.entries {
                    if let Some(ty) = &p.parameter_type {
                        visit(ty, names);
                    }
                }
                if let Some(ty) = &spec.return_type {
                    visit(ty.return_type, names);
                }
            }
        }
        Type::Conditional(t) => {
            visit(t.subject, names);
            visit(t.target, names);
            visit(t.then, names);
            visit(t.r#else, names);
        }
        Type::KeyOf(t) => visit(&t.parameter.entry.inner, names),
        Type::ValueOf(t) => visit(&t.parameter.entry.inner, names),
        Type::IntMask(t) => generics(&t.parameters, names),
        Type::IntMaskOf(t) => visit(&t.parameter.entry.inner, names),
        Type::New(t) => visit(&t.parameter.entry.inner, names),
        Type::TemplateType(t) => generics(&t.parameters, names),
        Type::IndexAccess(t) => {
            visit(t.target, names);
            visit(t.index, names);
        }
        Type::Negated(t) => visit(t.operand, names),
        Type::Posited(t) => visit(t.operand, names),
        Type::PropertiesOf(t) => visit(&t.parameter.entry.inner, names),
        Type::Slice(t) => visit(t.inner, names),
        _ => {}
    }
}
