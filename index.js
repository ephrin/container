const _ = require('lodash');
const Joi = require('joi');

const normalizeTag = tag => {
    if (_.isString(tag)) {
        return {name: tag};
    }

    if (_.isPlainObject(tag)) {
        if (_.has(tag, 'name')) {
            return tag;
        }
    }

    throw new Error('Service tags can be strings or plain objects with mandatory "name" field.');
};

/**
 * ES6 impl of Pimple dependency injection container inspired by pimple of M.PARAISO <mparaiso@online.fr>
 * @class Pimple
 */
class Pimple {

    constructor(definitions, deepClone = true) {
        this._deepClone = deepClone;
        this._definitions = new Map();
        this._labels = new Map();
        this._tags = new Map();
        this._reserved = [];
        this._reserved = _.keysIn(this);
        _.forOwn(definitions || {}, (definition, serviceId) => this.set(serviceId, definition))
    }

    /**
     * @param {string} serviceId
     * @return {*}
     */
    get(serviceId) {
        return this.getDefinition(serviceId).resolve();
    }

    /**
     * @param {string} serviceId
     * @return {Function}
     */
    getResolver(serviceId) {
        return this.getDefinition(serviceId).resolve;
    }

    /**
     * Sets or overrides new service. Can be configured additionally as instance of Definition by configurator cb
     * @param {string} serviceId
     * @param {Function|Object|any} definition
     * @param {...definitionConfiguratorCallback} [configurators]
     * @return {*}
     */
    set(serviceId, definition, ...configurators) {
        return this.setRaw(serviceId, this.create(definition), ...configurators);
    }

    /**
     * @param {string} serviceId
     * @return {Definition}
     */
    getDefinition(serviceId) {
        let definition = this._definitions.get(serviceId);

        if (!definition) {
            throw new Error(`Service with name ${serviceId} is not defined in container.`);
        }

        return definition;
    }

    /**
     * @param {string} serviceId
     * @param {Definition} definition
     * @param {...definitionConfiguratorCallback} [configurators]
     * @return {Pimple}
     */
    setRaw(serviceId, definition, ...configurators) {
        if (!definition instanceof Definition) {
            throw new Error('Raw definition should be an instance of Definition.');
        }

        definition.compile(serviceId);

        this._definitions.set(serviceId, definition);

        if (!this.isReserved(serviceId)) {
            Object.defineProperty(this, serviceId, {
                get: () => {
                    return this.get(serviceId);
                },
                configurable: true,
                enumerable: true
            });
        }

        /**
         * A callback to additionally configure service on it's registration
         * @callback definitionConfiguratorCallback
         * @param {Definition} definition currently registered definition of service
         * @param {Pimple} container
         */
        if (!_.isEmpty(configurators)) {
            _.over([...configurators])(definition, this);
        }

        return this;
    }

    /**
     * Sets service as singleton of. While getting the service by its id the same instance will be returned always
     * @param {string} serviceId
     * @param {Function|Object|any} definition
     * @param {...definitionConfiguratorCallback} [configures]
     */
    setShared(serviceId, definition, ...configures) {
        const def = this.create(definition);
        def.shared = true;
        this.setRaw(serviceId, def, ...configures);
    }

    /**
     * use a function to register a set of definitions
     * @param {Function} definitionProvider
     * @returns {*}
     */
    register(definitionProvider) {
        return definitionProvider(this);
    }

    /**
     * @param {Object|Function} definition
     * @param {Object} [context={Pimple}] Context to bing as this arg to a factory
     * @param [argument={Pimple}] arguments to pass to a factory callback or instance constructor
     * @return {Definition}
     */
    create(definition, context, argument) {
        return new Definition(definition, this, context || this, argument || this);
    }

    tag(service, ...tags) {
        _.forEach(tags, tag => {
            const plainTag = normalizeTag(tag);
            let tagged, tagsIn;
            if (!this._tags.has(plainTag.name)) {
                tagged = new Map();
                this._tags.set(plainTag.name, tagged);
            } else {
                tagged = this._tags.get(plainTag.name)
            }

            if (!tagged.has(service)) {
                tagsIn = [];
                tagged.set(service, tagsIn)
            } else {
                tagsIn = tagged.get(service);
            }

            tagsIn.push(plainTag);
        });
        return this;
    }

    /**
     * Retrieve a Map where serviceIds are service serviceIds and values are all matched tags defined for the service.
     * @param {string} tagName
     * @return {Map<service, Array>}
     */
    getTag(tagName) {
        return this._tags.has(tagName) ? this._tags.get(tagName) : new Map();
    }

    /**
     * @param {string} tagName
     * @param {object|array} [sortOptions] an options to sort tagged services by (example: {field: 'priority', order: -1} or ['priority', -1])
     * @param {string} [sortOptions.field] a field in tag object to get sort index from
     * @param {number} [sortOptions.order] positive or negative 1 (-1 or 1) to determine order vector.
     * @param {Function<serviceName,tag>}callback
     */
    overTags(tagName, sortOptions, callback) {
        if (_.isFunction(arguments[1])) {
            callback = arguments[1];
            sortOptions = undefined;
        }

        if (sortOptions) {
            if (_.isArray(sortOptions)) {
                sortOptions = {
                    field: sortOptions[0],
                    order: sortOptions[1]
                }
            }

            Joi.validate(
                sortOptions,
                Joi.object().keys({
                    field: Joi.string().required(),
                    order: Joi.number().min(-1).max(1).invalid(0).required()
                }),
                err => {
                    if (err) {
                        throw err;
                    }
                }
            );

            this.getSortedTags(tagName, (tagMap) => {
                let pairs = [];
                tagMap.forEach((tags, taggedService) => {
                    tags.forEach(tag => {
                        pairs.push([taggedService, tag])
                    })
                });

                return pairs.sort(([serviceA, tagA], [serviceB, tagB]) => {
                    let v1 = _.get(tagA, sortOptions.field, 0);
                    let v2 = _.get(tagB, sortOptions.field, 0);
                    if (v1 < v2) {
                        return -1 * sortOptions.order;
                    }

                    return v1 > v2 ? 1 * sortOptions.order : 0
                });
            }).forEach(([taggedServiceName, tag]) => callback(taggedServiceName, tag))

        } else {
            this.getTag(tagName).forEach((tags, taggedServiceName) => {
                tags.forEach((tag) => {
                    callback(taggedServiceName, tag)
                })
            })
        }
    }

    /**
     * @param {string} tagName
     * @param {function} sortFunction
     * @return {Array<[serviceName, tag]>}
     */
    getSortedTags(tagName, sortFunction) {
        return sortFunction(this.getTag(tagName))
    }

    /**
     * labels specific service to execute labeled callback whenever service instantiated
     * @param {string} serviceId A serviceId of service to addLabel
     * @param {string} labels labels to addLabel with
     * @return {Pimple}
     */
    addLabel(serviceId, ...labels) {
        const rawDef = this.getDefinition(serviceId);
        _.forEach(labels, label => rawDef.label(label));
        return this;
    }

    /**
     * Define
     * @param {string} label
     * @param {Function<service, Pimple>} callback
     * @return {Pimple}
     */
    defineLabel(label, callback) {
        this._labels.set(label, callback);
        return this;
    }

    getLabel(label) {
        if (!this._labels.has(label)) {
            throw new Error(
                `Pimple label "${label}" callback is not defined but service is labeled wih it.`
            );
        }

        return this._labels.get(label);
    }

    isReserved(serviceId) {
        return this._reserved.indexOf(serviceId) !== -1;
    }
}

/**
 * @class Definition
 */
class Definition {
    constructor(definition, container, context, ...args) {
        this.container = container;
        this._shared = false;
        this.labels = new Set([]);
        this.context = context;
        this.args = args;
        this.raw = this.configure(definition);
    }

    set shared(val) {
        this._shared = val;
    }

    get id() {
        if (!this.ID) {
            throw new Error('Service is not correctly compiled. No identifier specified.');
        }
        return this.ID;
    }

    configure(definition) {
        if (definition instanceof Definition) {
            this.context = definition.context;
            this.args = definition.args;
            definition = definition.resolve;
        }

        return definition;
    }

    /**
     * @param {string} name label name to set for the Definition
     * @param {Function} [labelToDefine] adds possibility to define common callback for the label in Pimple
     * @return {Definition}
     */
    label(name, labelToDefine) {
        this.labels.add(name);
        if (_.isFunction(labelToDefine)) {
            this.container.defineLabel(name, labelToDefine);
        }
        return this;
    }

    /**
     * Reverse method helper for Pimple to set tags on Definition directly
     * @param tags
     */
    tags(...tags) {
        this.container.tag(this.ID, ...tags);
        return this;
    }

    arguments() {
        return _.map(this.args, (arg) => {
            return arg instanceof Definition ? arg.resolve() : arg
        });
    }

    wrap(resolve) {
        //todo add circular reference guard

        let wrapped = _.wrap(resolve, (resolve) => {
            let instance = resolve();
            this.labels.forEach(label => {
                this.container.getLabel(label).apply(this, [instance, this.container, this.ID]);
            });
            return instance;
        });

        if (this._shared) {
            wrapped = _.once(wrapped)
        }

        return wrapped;
    }

    compile(serviceId) {
        this.ID = serviceId;
        this.resolve = this.wrap(this.createResolver(this.raw));
    }

    createResolver(definition) {
        if (_.isFunction(definition)) {
            return _.bind(definition, this.context, ...this.arguments());
        }

        if (_.isObject(definition)) {
            return () => {
                return this._shared ? definition : (this.container._deepClone ? _.cloneDeep(definition) : _.clone(definition))
            }
        }

        return _.constant(definition);
    }
}

/**
 * Labeling cb factory for configurator
 * @param {string} name name of the label
 * @param [callback] - define label callback for Pimple
 * @return {definitionConfiguratorCallback}
 */
exports.label = (name, callback) => {
    return (def) => {
        def.label(name, callback)
    }
};

/**
 * Tagging callback factory for configurator
 * @param tags
 * @return {definitionConfiguratorCallback}
 */
exports.tag = (...tags) => {
    return (def) => {
        def.tags(...tags);
    }
};

exports.Pimple = Pimple;
exports.Definition = Definition;
