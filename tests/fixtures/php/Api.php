<?php
namespace Demo;

use DateTimeImmutable as Clock;

/** An entity that can be named. */
interface Named {
    /** Return a display name. */
    public function name(): string;
}

/** Shared identifier behavior. */
trait Identified {
    public function id(): int { return 1; }
}

/**
 * A generic repository.
 *
 * @template T of Named
 */
abstract class Repository {
    /**
     * Fetch records.
     * @param array<string, list<T>> $filters Filtering rules.
     * @return list<T> The matching records.
     */
    abstract public function all(array $filters = []): array;
    protected function protectedHelper(): void {}
    private function secret(): void {}
}

/** A person. */
#[\AllowDynamicProperties]
final class Person extends Repository implements Named {
    use Identified;
    public const string KIND = 'person', OTHER = 'other';
    /** The recorded time. @var Clock */
    public Clock $created;
    public string $first = 'A', $last = 'B';
    public function __construct(public readonly string $label, private int $secret = 0) {}
    public function name(): string { return $this->label; }
    /** @deprecated Use name(). */
    public function oldName(): string { return $this->name(); }
    public function all(array $filters = []): array { return []; }
    /** @internal */
    public function implementation(): void {}
    public string $display { get => $this->label; }
    public function same(): self { return $this; }
    public function base(): parent { return $this; }
    /** @return array{Person: string, lower: Named, literal: 'Person', generic: list<TItem>} */
    public function shape(): array { return []; }
    /**
     * @template TItem
     * @param TItem $item
     * @return TItem
     */
    public function generic($item) { return $item; }
}

/** Available statuses. */
enum Status: string { case Active = 'active'; case Inactive = 'inactive'; }

/**
 * Format a person.
 * @param Person $person The person to format.
 * @return string The display value.
 */
function format(Person $person, bool &$flag = true, string ...$suffix): string {
    function implementationDetail(): void {}
    return $person->name();
}

/** @internal */
class InternalClass { public function shouldNotLeak(): void {} }

const VERSION = '1';
class TItem {}

/** Constructor promotion preserves property members without duplicate declarations. */
class Promotions {
    public string $explicit;
    public function __construct(
        public readonly string $first,
        public string $second,
        string $explicit,
    ) { $this->explicit = $explicit; }
}
