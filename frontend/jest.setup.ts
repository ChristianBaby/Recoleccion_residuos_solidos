/**
 * Polyfills para el entorno de tests (jsdom).
 *
 * `jest-environment-jsdom` no expone `structuredClone`, que `fake-indexeddb`
 * necesita para clonar los registros (algoritmo de clonado estructurado de
 * IndexedDB). Se emula con el serializador de V8 de Node, que soporta los
 * mismos tipos (Date, Map, Set, TypedArray, etc.).
 */
import { serialize, deserialize } from 'node:v8'

if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = <T>(value: T): T => deserialize(serialize(value))
}
