"use strict";

/* The concept of whitelisting is pretty easy to explain, but hard to implement.
 * Basically, when you whitelist a set of properties, you are restricting what
 * other users can see of your property lists.  One good analogy is private
 * properties and methods in C++.  JavaScript technically doesn't have private
 * properties, only closures which attempt to emulate them, and proxies which
 * really can emulate them, with some difficulty.
 *
 * This use case is a demonstration of a practical whitelisting, protecting
 * certain properties from being accessed or overwritten incorrectly.  It relies
 * on four main features of the membrane:
 *
 * (1) storeUnknownAsLocal, which means that new properties do not propagate to
 * the underlying objects
 * (2) requireLocalDelete, which means that delete operations do not propagate.
 * (3) filterOwnKeys, which limits the list of properties that proxies do see
 * (4) Proxy listeners, which can apply the other three features to a proxy
 *     when the membrane first creates the proxy, and notably before the
 *     end-user ever sees that proxy.
 *
 * "trusted" code should never assume that "untrusted" code doesn't locally
 * define a property name that trusted code relies on.  The filterOwnKeys
 * feature hides a property, while storeUnknownAsLocal and requireLocalDelete
 * prevent the untrusted code from affecting the trusted property.
 *
 * It's important to note that the whitelisting has to work both ways:  an event
 * listener in the DOM, for instance, comes from "untrusted" code, and "trusted"
 * code must only see the .handleEvent() method of the untrusted event handler.
 * Otherwise, the trusted code could accidentally contaminate the event handler
 * with unexpected properties.
 */

if (typeof MembraneMocks != "function") {
  if (typeof require == "function") {
    var { MembraneMocks } = require("../../dist/node/mocks.js");
  }
  else
    throw new Error("Unable to run tests: cannot get MembraneMocks");
}

describe("Use case:  The membrane can be used to safely whitelist properties", function() {
  it("manually", function() {
    function HEAT() { return descWet.value.apply(this, arguments); }
    function HEAT_NEW() { return "Hello World"; }

    const EventListenerWetWhiteList = [
      "handleEvent",
    ];

    const EventTargetWhiteList = [
      "addEventListener",
      "dispatchEvent",
    ];

    const NodeWhiteList = [
      "childNodes",
      "ownerDocument",
      "parentNode",
    ];

    const NodeProtoWhiteList = [
      "insertBefore",
      "firstChild",
    ];

    const ElementWhiteList = [
      "nodeType",
      "nodeName",
    ];

    const docWhiteList = [
      "ownerDocument",
      "childNodes",
      "nodeType",
      "nodeName",
      "parentNode",
      "createElement",
      "insertBefore",
      "firstChild",
      "baseURL",
      "addEventListener",
      "dispatchEvent",
      "rootElement",
    ];

    function buildFilter(names, prevFilter) {
      return function(elem) {
        if (prevFilter && prevFilter(elem))
          return true;
        return names.includes(elem);
      };
    }

    const nameFilters = {};
    nameFilters.doc = buildFilter(docWhiteList);
    nameFilters.listener = buildFilter(EventListenerWetWhiteList);
    nameFilters.target = buildFilter(EventTargetWhiteList);
    nameFilters.node = buildFilter(NodeWhiteList, nameFilters.target);
    nameFilters.element = buildFilter(ElementWhiteList, nameFilters.node);
    nameFilters.proto = {};
    nameFilters.proto.node = buildFilter(NodeProtoWhiteList, nameFilters.target);
    nameFilters.proto.element = buildFilter([], nameFilters.proto.node);
    
    var parts, dryWetMB, descWet;
    var EventListenerProto, checkEvent = null;
    var mockOptions = {
      whitelist: function(meta, filter, field = "wet") {
        dryWetMB.modifyRules.storeUnknownAsLocal(field, meta.target);
        dryWetMB.modifyRules.requireLocalDelete(field, meta.target);
        dryWetMB.modifyRules.filterOwnKeys(field, meta.target, filter);
        meta.stopIteration();
      },

      wetHandlerCreated: function(handler, Mocks) {
        parts = Mocks;
        dryWetMB = parts.membrane;
        EventListenerProto = Object.getPrototypeOf(parts.wet.Node.prototype);

        {
          let oldHandleEvent = EventListenerProto.handleEventAtTarget;
          EventListenerProto.handleEventAtTarget = function() {
            if (checkEvent)
              checkEvent.apply(this, arguments);
            return oldHandleEvent.apply(this, arguments);
          };
          parts.wet.doc.handleEventAtTarget = EventListenerProto.handleEventAtTarget;
        }


        var listener = (function(meta) {
          if ((meta.callable !== EventListenerProto.addEventListener) ||
              (meta.trapName !== "apply") ||
              (meta.argIndex !== 1))
            return;

          if (typeof meta.target == "function")
            return;

          if ((typeof meta.target != "object") || (meta.target === null))
            meta.throwException(new Error(".addEventListener requires listener be an object or a function!"));

          try {
            this.whitelist(meta, nameFilters.listener, "dry");
          }
          catch (ex) {
            meta.throwException(ex);
          }
        }).bind(this);
        handler.addProxyListener(listener);
      },

      dryHandlerCreated: function(handler/*, Mocks */) {
        var listener = (function(meta) {
          if (meta.target === parts.wet.doc) {
            // parts.dry.doc will be meta.proxy.
            this.whitelist(meta, nameFilters.doc);
            return;
          }
          if (meta.target instanceof parts.wet.Element) {
            // parts.dry.Element will be meta.proxy.
            this.whitelist(meta, nameFilters.element);
            return;
          }
          if (meta.target instanceof parts.wet.Node) {
            // parts.dry.Node will be meta.proxy.
            this.whitelist(meta, nameFilters.node);
            return;
          }

          if (meta.target === parts.wet.Element) {
            this.whitelist(meta, nameFilters.proto.element);
            return;
          }

          if (meta.target === parts.wet.Node) {
            this.whitelist(meta, nameFilters.proto.node);
            return;
          }

          if (meta.target === parts.wet.Node.prototype) {
            this.whitelist(meta, nameFilters.proto.node);
            return;
          }

          if (meta.target === EventListenerProto) {
            this.whitelist(meta, nameFilters.target);
            return;
          }
        }).bind(this);

        handler.addProxyListener(listener);
      },
    };

    parts = MembraneMocks(false, null, mockOptions);
    var wetDocument = parts.wet.doc, dryDocument = parts.dry.doc;

    {
      descWet = Reflect.getOwnPropertyDescriptor(wetDocument, "nodeName");
      let descDry = Reflect.getOwnPropertyDescriptor(dryDocument, "nodeName");
      expect(typeof descWet).not.toBe(undefined);
      expect(typeof descDry).not.toBe(undefined);
      if (descWet && descDry) {
        expect(descWet.value).toBe("#document");
        expect(descDry.value).toBe("#document");
      }
    }

    {
      descWet = Reflect.getOwnPropertyDescriptor(wetDocument, "handleEventAtTarget");
      expect(descWet).not.toBe(undefined);
      expect(typeof descWet.value).toBe("function");
      let descDry = Reflect.getOwnPropertyDescriptor(dryDocument, "handleEventAtTarget");
      expect(descDry).toBe(undefined);
    }

    {
      // Redefining a not-whitelisted property on the wet document has no effect on the dry document.
      descWet = Reflect.getOwnPropertyDescriptor(wetDocument, "handleEventAtTarget");
      Reflect.defineProperty(wetDocument, "handleEventAtTarget", {
        value: HEAT,
        writable: false,
        enumerable: true,
        configurable: true,
      });

      let descDry = Reflect.getOwnPropertyDescriptor(dryDocument, "handleEventAtTarget");
      expect(descDry).toBe(undefined);

      Reflect.defineProperty(wetDocument, "handleEventAtTarget", descWet);
    }

    {
      let oldDescWet = Reflect.getOwnPropertyDescriptor(wetDocument, "handleEventAtTarget");
      // Defining a not-whitelisted property on the dry document has no effect on the wet document.
      let defined = Reflect.defineProperty(dryDocument, "handleEventAtTarget", {
        value: HEAT_NEW,
        writable: false,
        enumerable: true,
        configurable: true
      });
      expect(defined).toBe(true);
      descWet = Reflect.getOwnPropertyDescriptor(wetDocument, "handleEventAtTarget");
      expect(descWet).not.toBe(undefined);
      if (descWet)
        expect(descWet.value).toBe(oldDescWet.value);

      let descDry = Reflect.getOwnPropertyDescriptor(dryDocument, "handleEventAtTarget");
      expect(descDry).not.toBe(undefined);
      if (descDry)
        expect(descDry.value).toBe(HEAT_NEW);
    }

    // Clean up.
    parts.dry.doc.dispatchEvent("unload");
  });
});