// Make Vue reactivity primitives available as globals in node unit tests.
// This allows importing composables that call ref/computed at module scope.
import * as vue from 'vue'
Object.assign(globalThis, vue)
