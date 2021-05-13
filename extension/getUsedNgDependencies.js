function main() {
	'use strict';

	function deepForEach({ root, callback, ignoredKeys = new Set(), ignoredValues = new Set(), keys = [] }) {
		if (ignoredValues.has(root)) {
			return;
		}

		const { isObject, isFunction } = typeCheck(root);

		if (!isObject) {
			if (callback(root, keys) === true) {
				return;
			}
		}

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
	}

	const exportedFunctions = new Map();

	function storeExportedFunctions(exports, path) {
		deepForEach({
			root: exports,
			callback(value, keys) {
				if (typeof value === 'function') {
					exportedFunctions.set(value, [...path, ...keys]);
				}
				return keys.length > 3;
			}
		});
	}

	let lastProp;

	function getNewGlobals() {
		if (lastProp === undefined) {
			const iframe = document.createElement('iframe');
			document.head.appendChild(iframe);
			for (const prop in iframe.contentWindow) {
				if (iframe.contentWindow.hasOwnProperty(prop)) {
					lastProp = prop;
				}
			}
			document.head.removeChild(iframe);
		}

		let capture = false;
		const newGlobals = {};

		for (const prop in window) {
			if (lastProp === prop) {
				capture = true;
				continue;
			}
			if (capture && window.hasOwnProperty(prop)) {
				lastProp = prop;
				newGlobals[prop] = window[prop];
			}
		}

		return newGlobals;
	}

	const docCreateElement = document.createElement;

	document.createElement = function () {
		const el = docCreateElement.apply(this, arguments);

		if (el.nodeName === 'SCRIPT') {
			getNewGlobals();
			el.addEventListener('load', function onload() {
				el.removeEventListener('load', onload);
				const pathname = new URL(el.src, 'file:').pathname;
				storeExportedFunctions(getNewGlobals(), [pathname, 'window']);
			});
		}

		return el;
	};

	let System;

	Object.defineProperty(window, 'System', {
		get: () => System,
		set(v) {
			System = v;
			if (window.angular && System.import) {
				const systemImport = System.import;
				System.import = function (specifier) {
					const pathname = new URL(specifier, 'file:').pathname;
					return systemImport.apply(this, arguments).then((exports) => {
						storeExportedFunctions(getNewGlobals(), [pathname, 'window']);
						storeExportedFunctions(exports, [pathname, 'exports']);
						return exports;
					});
				};
			}
		},
		enumerable: true
	});

	function typeCheck(value) {
		const type = typeof value;
		return {
			isObject: type === 'object' && value !== null,
			isFunction: type === 'function'
		};
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
		const ignoredValues = [
			window,
			document,
			getInjector().get('$rootElement'),
			'true',
			'True',
			'false',
			'False',
			...Array.from({ length: 101 }, (_, i) => String(i))
		];
		const ngDependencies = new Map();

		deepForEach({
			root: getNgDependencies(),
			callback(value, keys) {
				if (typeof value === 'function') {
					ngDependencies.set(value, keys.join('.'));
				}
			},
			ignoredKeys: new Set(ignoredKeys),
			ignoredValues: new Set(ignoredValues)
		});

		return ngDependencies;
	}

	const ngProps = {};

	function addToNgProps(props, identifier, callstackRegex) {
		const allNgDependencies = getFlatNgDependencies();
		const callstack = callstackRegex.exec(new Error().stack)?.[1];

		const entry = ngProps[identifier] || {
			propMap: {},
			lastCallstack: callstack
		};

		entry.lastCallstack = callstack;

		deepForEach({
			root: props,
			callback(value, keys) {
				if (allNgDependencies.has(value) && typeof value === 'function') {
					entry.propMap[keys.join('.')] = allNgDependencies.get(value);
				}
			}
		});

		if (!ngProps[identifier] && Object.keys(entry.propMap).length) {
			ngProps[identifier] = entry;
		}
	}

	const rendererCallstackRegex = /patchedRender(?![^]*patchedRender).*\n([^]+)/;

	function patchRender(originalRender) {
		return function patchedRender(element, node) {
			if (node && typeCheck(element && element.props).isObject && !exportedFunctions.has(element.type)) {
				const nodeAttributes = Object.values(node.attributes).map(({ name, value }) =>
					value ? `${name}=${JSON.stringify(value)}` : name
				);
				const identifier = `<${node.nodeName.toLowerCase()} ${nodeAttributes.join(' ')} />`;

				addToNgProps(element.props, identifier, rendererCallstackRegex);
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

	const createElementCallstackRegex = /patchedCE(?![^]*patchedCE).*\n([^]+)/;

	function patchCreateElement(originalCreateElement) {
		return function patchedCE(elementType, props) {
			if (exportedFunctions.has(elementType)) {
				const [url, ...exportPath] = exportedFunctions.get(elementType);
				const identifier = `${url} ${exportPath.join('.')}`;

				addToNgProps(props, identifier, createElementCallstackRegex);
			}

			return originalCreateElement.apply(this, arguments);
		};
	}

	let React;

	Object.defineProperty(window, 'React', {
		get: () => React,
		set(v) {
			React = Object.assign({}, v);
			if (window.angular) {
				React.createElement = patchCreateElement(v.createElement);
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
