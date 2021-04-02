function main() {
	'use strict';

	const proxiedItems = new WeakSet();
	const globals = new Set(Object.getOwnPropertyNames(window).map((prop) => window[prop]));

	function typeCheck(value) {
		const type = typeof value;
		const result = {
			isObject: type === 'object' && value !== null,
			isFunction: type === 'function',
			isString: type === 'string',
			isNumber: type === 'number' && !Number.isNaN(value)
		};
		result.isNotEmptyString = result.isString && value !== '';
		result.isObjectOrFunction = result.isObject || result.isFunction;

		return result;
	}

	function shouldntProxy(target) {
		return (
			!typeCheck(target).isObjectOrFunction ||
			target.hasOwnProperty !== Object.prototype.hasOwnProperty ||
			proxiedItems.has(target) ||
			globals.has(target) ||
			target instanceof EventTarget ||
			target instanceof Event
		);
	}

	function addGetHandler(target, onGet, path = []) {
		if (shouldntProxy(target)) {
			return target;
		}

		return new Proxy(target, {
			get(currentTarget, property) {
				const value = currentTarget[property];

				onGet(value, [...path, property]);

				if (shouldntProxy(value)) {
					return value;
				}

				const { writable, configurable } = Object.getOwnPropertyDescriptor(currentTarget, property) || {};

				if (writable || configurable) {
					const proxied = addGetHandler(value, onGet, [...path, property]);
					proxiedItems.add(proxied);
					return proxied;
				}

				return value;
			},
			construct(target, args) {
				return new target(...args);
			}
		});
	}

	function deepForEach({ root, callback, ignoredKeys = new Set(), ignoredValues = new Set(), keys = [] }) {
		if (ignoredValues.has(root)) {
			return;
		}

		const { isObject, isObjectOrFunction } = typeCheck(root);

		if (isObjectOrFunction) {
			ignoredValues.add(root);
			for (const [key, value] of Object.entries(root)) {
				if (!ignoredKeys.has(key)) {
					deepForEach({
						root: value,
						callback,
						ignoredKeys,
						ignoredValues,
						keys: [...keys, key]
					});
				}
			}
		}

		if (!isObject) {
			callback(root, keys);
		}
	}

	function getInjector() {
		return angular.element(document.body).injector();
	}

	function getNgDependencies() {
		let deps;
		const hasOwnProp = Object.prototype.hasOwnProperty;

		Object.prototype.hasOwnProperty = function () {
			deps = this;
			Object.prototype.hasOwnProperty = hasOwnProp;
			return hasOwnProp.apply(this, arguments);
		};

		try {
			getInjector().get('');
		} catch (e) {}

		return deps;
	}

	function getFlatNgDependencies() {
		const ignoredKeys = [
			'_configBlocks',
			'_invokeQueue',
			'_runBlocks',
			'$$childHead',
			'$$childTail',
			'$$ChildScope',
			'$$listeners',
			'$$watchers'
		];
		const ignoredValues = [window, document, getInjector().get('$rootElement')];
		const ngDependencies = new Map();

		deepForEach({
			root: getNgDependencies(),
			callback(value, keys) {
				const t = typeCheck(value);
				if (t.isObjectOrFunction || t.isNumber || t.isNotEmptyString) {
					ngDependencies.set(value, keys.join('.'));
				}
			},
			ignoredKeys: new Set(ignoredKeys),
			ignoredValues: new Set(ignoredValues)
		});

		return ngDependencies;
	}

	const ngProps = {};
	const callLocationRegex = /patchedRender(?![^]*patchedRender).*\n([^]+)/;

	function patchRender(originalRender) {
		return function patchedRender(element, node) {
			if (node && typeCheck(element && element.props).isObject) {
				const allNgDependencies = getFlatNgDependencies();
				const renderCallstack = callLocationRegex.exec(new Error().stack)?.[1];
				const nodeAttributes = Object.values(node.attributes).map(({ name, value }) =>
					value ? `${name}=${JSON.stringify(value)}` : name
				);
				const nodeString = `<${node.nodeName.toLowerCase()} ${nodeAttributes.join(' ')} />`;

				const entry = (ngProps[nodeString] = ngProps[nodeString] || {
					propMap: {},
					lastCallstack: renderCallstack
				});

				entry.lastCallstack = renderCallstack;

				element.props = addGetHandler(element.props, (value, path) => {
					if (allNgDependencies.has(value)) {
						entry.propMap[path.join('.')] = typeCheck(value).isObjectOrFunction
							? allNgDependencies.get(value)
							: value;
					}
				});
			}

			return originalRender.apply(this, arguments);
		};
	}

	let ReactDOM;

	Object.defineProperty(window, 'ReactDOM', {
		get: () => ReactDOM,
		set(v) {
			ReactDOM = Object.assign({}, v);
			if (window.angular) {
				ReactDOM.render = patchRender(v.render);
			}
		},
		enumerable: true
	});

	window.getUsedNgDependencies = () => ngProps;
}

const script = document.createElement('script');
script.textContent = `(${main.toString()})()`;
document.documentElement.appendChild(script);
script.remove();
