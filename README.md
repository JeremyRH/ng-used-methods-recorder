## How to record
Add the `extension` folder as an unpacked extension.
Go to any web page using AngularJS and React and click on things, navigate around, do some stuff.
When you're ready, open the browser console and type `getUsedNgMethods()` to see all your React components using AngularJS methods.

## Understanding the output
```json
{
  "<DOM node containing the React component>": {
    "propMap": {
      "<React component prop path>": "<AngularJS dependency path>"
    },
    "renderCallstacks": ["<Snapshots of callstacks on ReactDOM.render()>"]
  }
}
```
Example:
```json
{
  "<div id='adminsettingsView' class='ng-scope' />": {
    "propMap": {
      "helpers.translate": "$locale.getString"
    },
    "renderCallstacks": ["    at t.value (https://..."]
  }
}
```
