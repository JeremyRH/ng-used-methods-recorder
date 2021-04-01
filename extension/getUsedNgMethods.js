function main() {
	'use strict';

	function deepForEach({ root, callback, ignoredKeys = new Set(), ignoredValues = new Set(), keys = [] }) {
		if (ignoredValues.has(root)) {
			return;
		}

		const isObject = root && typeof root === 'object';
		const isFunction = typeof root === 'function';

		if (isObject || isFunction) {
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

	function getNgFunctionDependencies() {
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
		const ngDependencyFns = new Map();

		deepForEach({
			root: getNgDependencies(),
			callback(value, keys) {
				if (typeof value === 'function') {
					ngDependencyFns.set(value, keys.join('.'));
				}
			},
			ignoredKeys: new Set(ignoredKeys),
			ignoredValues: new Set(ignoredValues)
		});

		return ngDependencyFns;
	}

	const ngFunctionProps = {};
	const callLocationRegex = /patchedRender(?![^]*patchedRender).*\n([^]+)/;

	function patchRender(originalRender) {
		return function patchedRender(element, node) {
			if (node && element && typeof element.props === 'object') {
				const allNgFunctions = getNgFunctionDependencies();
				const renderCallstack = callLocationRegex.exec(new Error().stack)?.[1];
				const nodeAttributes = Object.values(node.attributes).map(({ name, value }) =>
					value ? `${name}=${JSON.stringify(value)}` : name
				);
				const nodeString = `<${node.nodeName.toLowerCase()} ${nodeAttributes.join(' ')} />`;

				const entry = (ngFunctionProps[nodeString] = ngFunctionProps[nodeString] || {
					propMap: {},
					renderCallstacks: [renderCallstack]
				});

				if (!entry.renderCallstacks.includes(renderCallstack)) {
					entry.renderCallstacks.push(renderCallstack);
				}

				deepForEach({
					root: element.props,
					callback(value, keys) {
						if (!allNgFunctions.has(value)) {
							return;
						}
						const propPath = keys.join('.');
						const parent = keys.slice(0, -1).reduce((v, key) => v[key], element.props);
						const key = keys[keys.length - 1];
						parent[key] = function wrapped() {
							entry.propMap[propPath] = allNgFunctions.get(value);
							return this instanceof wrapped ? new value(...arguments) : value.apply(this, arguments);
						};
					},
					ignoredKeys: new Set(['$$childHead', '$$childTail'])
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

	window.getUsedNgMethods = () => ngFunctionProps;
}

const script = document.createElement('script');
script.textContent = `(${main.toString()})()`;
document.documentElement.appendChild(script);
script.remove();
