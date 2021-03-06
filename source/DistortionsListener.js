function DistortionsListener(membrane) {
  // private
  Object.defineProperties(this, {
    "membrane":
      new NWNCDataDescriptor(membrane, false),
    "preProxyListener":
      new NWNCDataDescriptor(this.preProxyListener.bind(this), false),
    "proxyListener":
      new NWNCDataDescriptor(this.proxyListener.bind(this), false),
    "valueAndProtoMap":
      new NWNCDataDescriptor(new Map(/*
        object or function.prototype: JSON configuration
      */), false),
  
    "instanceMap":
      new NWNCDataDescriptor(new Map(/*
        function: JSON configuration
      */), false),

    "filterToConfigMap":
      new NWNCDataDescriptor(new Map(/*
        function returning boolean: JSON configuration
      */), false),
  
    "ignorableValues":
      new NWNCDataDescriptor(new Set(), false),
  });
}

Object.defineProperties(DistortionsListener.prototype, {
  "addListener": new NWNCDataDescriptor(function(value, category, config) {
    if ((category === "prototype") || (category === "instance"))
      value = value.prototype;
    if ((category === "prototype") || (category === "value"))
      this.valueAndProtoMap.set(value, config);
    else if (category === "instance")
      this.instanceMap.set(value, config);
    else if ((category === "filter") && (typeof value === "function"))
      this.filterToConfigMap.set(value, config);
  }),

  "removeListener": new NWNCDataDescriptor(function(value, category) {
    if ((category === "prototype") || (category === "instance"))
      value = value.prototype;
    if ((category === "prototype") || (category === "value"))
      this.valueAndProtoMap.set(value);
    else if (category === "instance")
      this.instanceMap.delete(value);
  }),

  "listenOnce": new NWNCDataDescriptor(function(meta, config) {
    this.addListener(meta.target, "value", config);
    try {
      this.proxyListener(meta);
    }
    finally {
      this.removeListener(meta.target, "value");
    }
  }),

  "sampleConfig": new NWNCDataDescriptor(function(isFunction) {
    const rv = {
      formatVersion: "0.8.0",
      dataVersion: "0.1",

      filterOwnKeys: [],
      inheritOwnKeys: false,
      storeUnknownAsLocal: false,
      requireLocalDelete: false,
      proxyTraps: allTraps.slice(0),
      useShadowTarget: false,
    };

    if (isFunction) {
      rv.truncateArgList = false;
    }
    return rv;
  }, true),

  "bindToHandler": new NWNCDataDescriptor(function(handler) {
    if (!this.membrane.ownsHandler(handler)) {
      throw new Error("Membrane must own the first argument as an object graph handler!");
    }
    handler.addPreProxyListener(this.preProxyListener);
    handler.addProxyListener(this.proxyListener);
  }, true),

  "ignorePrimordials": new NWNCDataDescriptor(function() {
    Primordials.forEach(function(p) {
      if (p)
        this.ignorableValues.add(p);
    });
  }, true),

  /**
   * @private
   */
  "preProxyListener": new NWNCDataDescriptor(function(meta) {
    if (meta.target in this.ignorableValues) {
      meta.override(meta.target);
      meta.stopPropagation();
    }
  }, false),

  /**
   * @private
   */
  "proxyListener": new NWNCDataDescriptor(function(meta) {
    let config = this.valueAndProtoMap.get(meta.target);
    if (!config) {
      let proto = Reflect.getPrototypeOf(meta.target);
      config = this.instanceMap.get(proto);
    }

    if (!config) {
      let iter, filter, testConfig;
      iter = this.filterToConfigMap.entries();
      let entry = iter.next();
      while (!entry.done && !meta.stopped) {
        filter = entry.value[0];
        testConfig = entry.value[1];
        if (filter(meta)) {
          config = testConfig;
          entry.done = true;
        }
        else {
          entry = iter.next();
        }
      }
    }

    if (!config)
      return;

    const rules = this.membrane.modifyRules;
    const fieldName = meta.handler.fieldName;
    if (Array.isArray(config.filterOwnKeys)) {
      rules.filterOwnKeys(
        fieldName,
        meta.proxy,
        config.filterOwnKeys,
        {
          inheritFilter: Boolean(config.inheritOwnKeys)
        }
      );
    }

    const deadTraps = this.membrane.allTraps.filter(function(key) {
      return !config.proxyTraps.includes(key);
    });
    rules.disableTraps(fieldName, meta.proxy, deadTraps);

    if (config.storeUnknownAsLocal)
      rules.storeUnknownAsLocal(fieldName, meta.proxy);

    if (config.requireLocalDelete)
      rules.requireLocalDelete(fieldName, meta.proxy);

    if (("truncateArgList" in config) && (config.truncateArgList !== false))
      rules.truncateArgList(fieldName, meta.proxy, config.truncateArgList);

    meta.stopIteration();
  }, false),
});

Object.freeze(DistortionsListener.prototype);
