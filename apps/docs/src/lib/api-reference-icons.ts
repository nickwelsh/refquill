import type { ApiReferenceIcons } from '@nickwelsh/refquill-fumadocs/components';
import Cube from '~icons/carbon/cube';
import InterfaceDefinition from '~icons/carbon/interface-definition';
import Layers from '~icons/carbon/layers';
import EnumerationDefinition from '~icons/carbon/enumeration-definition';
import EnumerationUsage from '~icons/carbon/enumeration-usage';
import FunctionIcon from '~icons/carbon/function-2';
import ValueVariable from '~icons/carbon/value-variable';
import AttributeDefinition from '~icons/carbon/attribute-definition';
import Data from '~icons/carbon/data-1';
import Folder from '~icons/carbon/folder';
import Types from '~icons/carbon/types';
import Hashtag from '~icons/carbon/hashtag';
import ChevronRight from '~icons/carbon/chevron-right';
import EventIncident from '~icons/carbon/event-incident';
import ReactLogo from '~icons/carbon/logo-react';
import VueLogo from '~icons/carbon/logo-vue';
import SvelteLogo from '~icons/carbon/logo-svelte';

export const apiReferenceIcons = {
    'react-component': ReactLogo,
    'react-hook': ReactLogo,
    'vue-component': VueLogo,
    'svelte-component': SvelteLogo,
    'solid-component': Layers,
    class: Cube,
    exception: EventIncident,
    interface: InterfaceDefinition,
    trait: Layers,
    enum: EnumerationDefinition,
    'enum-case': EnumerationUsage,
    function: FunctionIcon,
    method: FunctionIcon,
    constructor: FunctionIcon,
    property: AttributeDefinition,
    constant: Hashtag,
    variable: ValueVariable,
    'type-alias': Types,
    namespace: Folder,
    module: Folder,
    accessor: ValueVariable,
    struct: Cube,
    union: Layers,
    impl: InterfaceDefinition,
    macro: FunctionIcon,
    primitive: Types,
    'extern-type': Types,
    reexport: Types,
    'trait-alias': Layers,
    field: ValueVariable,
    variant: EnumerationUsage,
    'enum-member': EnumerationUsage,
    'associated-function': FunctionIcon,
    'associated-type': Types,
    'associated-constant': Hashtag,
    static: Data,
    parameter: ValueVariable,
    'type-parameter': Types,
    generic: Types,
    intersection: Layers,
    'type-alternative': Types,
    extends: Layers,
    implements: InterfaceDefinition,
    uses: Layers,
    'inherited-from': Layers,
    overrides: FunctionIcon,
    reexports: Types,
    'chevron-right': ChevronRight,
} satisfies Required<ApiReferenceIcons>;
