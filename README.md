## How to record
Add the `extension` folder as an unpacked extension.
Go to any web page using AngularJS and React and click on things, navigate around, do some stuff.
When you're ready, open the browser console and type `getUsedNgFunctions()` to see all your React components using AngularJS methods.

## Understanding the output
```js
{
  "<some-asset-url>:<line number>:<column number>": {
    "<React component prop path>": "<AngularJS dependency path>"
  }
}
```
Example:
```js
{
  "https://example.com/cdn/my-react-component.js:22:55": {
    "helpers.translate": "$locale.getString"
  }
}
```
