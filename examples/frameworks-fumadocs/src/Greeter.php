<?php

namespace Demo;

/** A PHP API documented beside frontend components. */
final class Greeter
{
    /** Greet a named person. */
    public function greet(string $name): string
    {
        return "Hello, {$name}!";
    }
}
