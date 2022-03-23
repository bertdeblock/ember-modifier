import { capabilities } from '@ember/modifier';
import { gte } from 'ember-compatibility-helpers';
import { set } from '@ember/object';
import {
  destroy,
  registerDestructor,
  associateDestroyableChild,
} from '@ember/destroyable';

import ClassBasedModifier, { _implementsModify } from './modifier';
import { ArgsFor, ElementFor } from 'ember-modifier/-private/signature';
import { consumeArgs, Factory, isFactory } from '../compat';

function destroyModifier<S>(modifier: ClassBasedModifier<S>): void {
  modifier.willDestroy();
}

/**
 * The state bucket used throughout the life-cycle of the modifier. Basically a
 * state *machine*, where the framework calls us with the version we hand back
 * to it at each phase. The two states are the two `extends` versions of this
 * below.
 * @internal
 */
interface State<S> {
  instance: ClassBasedModifier<S>;
  element: ElementFor<S> | null;
}

/**
 * The `State` after calling `createModifier`, and therefore the state available
 * at the start of `InstallModifier`.
 * @internal
 */
interface CreateState<S> extends State<S> {
  element: null;
}

/**
 * The `State` after calling `installModifier`, and therefore the state
 * available in all `updateModifier` calls and in `destroyModifier`.
 * @internal
 */
interface InstalledState<S> extends State<S> {
  element: ElementFor<S>;
}

export default class ClassBasedModifierManager<S> {
  capabilities = capabilities(gte('3.22.0') ? '3.22' : '3.13');

  constructor(private owner: unknown) {}

  createModifier(
    factoryOrClass:
      | Factory<typeof ClassBasedModifier>
      | typeof ClassBasedModifier,
    args: ArgsFor<S>
  ): CreateState<S> {
    const Modifier = isFactory(factoryOrClass)
      ? factoryOrClass.class
      : factoryOrClass;

    const modifier = new Modifier(this.owner, args);

    const state: CreateState<S> = {
      instance: modifier,
      element: null,
    };

    registerDestructor(modifier, destroyModifier);

    return state;
  }

  installModifier(
    state: CreateState<S>,
    element: ElementFor<S>,
    args: ArgsFor<S>
  ): void {
    // SAFETY: this cast represents how we are actually handling the state
    // machine transition: from this point forward in the lifecycle of the
    // modifier, it always behaves as `InstalledState<S>`. It is safe because,
    // and *only* because, we immediately initialize `element`. (We cannot
    // create a new state from the old one because the modifier manager API
    // expects mutation of a single state bucket rather than updating it at
    // hook calls.)
    const installedState = state as State<S> as InstalledState<S>;
    installedState.element = element;

    // TODO: this can be deleted entirely at v4.
    const { instance } = installedState;
    instance.element = element;

    // The `consumeArgs()` call backwards compatibility on v3 for the deprecated
    // legacy lifecycle hooks (`didInstall`, `didReceiveArguments`, and
    // `didUpdateArguments`), which accidentally had eager consumption semantics
    // prior to Ember 3.22. The new, recommended `modify` hook has the updated
    // lazy semantics associated with normal auto-tracking.
    const implementsModify = _implementsModify(instance);
    if (gte('3.22.0') && !implementsModify) {
      consumeArgs(args);
    }

    if (implementsModify) {
      instance.modify(element, args.positional, args.named);
    } else {
      instance.didReceiveArguments();
      instance.didInstall();
    }
  }

  updateModifier(state: InstalledState<S>, args: ArgsFor<S>): void {
    const { instance } = state;

    set(instance, 'args', args); // TODO: remove aat 4.0

    // The `consumeArgs()` call backwards compatibility on v3 for the deprecated
    // legacy lifecycle hooks (`didInstall`, `didReceiveArguments`, and
    // `didUpdateArguments`), which accidentally had eager consumption semantics
    // prior to Ember 3.22. The new, recommended `modify` hook has the updated
    // lazy semantics associated with normal auto-tracking.
    const implementsModify = _implementsModify(instance);
    if (gte('3.22.0') && !implementsModify) {
      consumeArgs(args);
    }

    if (implementsModify) {
      instance.modify(state.element, args.positional, args.named);
    } else {
      instance.didUpdateArguments();
      instance.didReceiveArguments();
    }
  }

  destroyModifier(state: InstalledState<S>): void {
    destroy(state.instance);
  }
}
