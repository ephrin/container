const {describe} = require('mocha');
const {expect} = require('chai');
const {Container, tag, label} = require('../index.js');
const _ = require('lodash');

describe('Container', function () {
    describe('#set()', () => {
        it('should add service definition to the container', () => {
            const pimple = new Container();
            const data = {data: 'test'};
            pimple.set('data', data);
            expect(pimple.get('data'), 'copy is same').to.be.eql(data);
            expect(pimple.get('data'), 'gives a copy').to.be.not.equal(data);
        });
        it('can be anything', () => {
            const pimple = new Container({value: 'string', nan: NaN});
            expect(pimple.get('value')).to.equal('string');
            expect(pimple.get('nan')).to.be.NaN;
        });
        it('but functions are treated as factory functions', () => {
            const pimple = new Container({
                arrOfContextAndArguments: function (...args) {
                    return [this, ...args]
                }
            });

            expect(pimple.get('arrOfContextAndArguments')).to.be.eql([pimple, pimple])
        });
        it('configure callbacks and reverse tags method of definition', () => {
            const pimple = new Container();

            pimple.set('myObj', {a: 1}, tag('objects'));

            expect(Array.from(pimple.getTag('objects').keys())).to.be.eql(['myObj'])
        })
    });
    describe('#setShared()', function () {
        it('shared instances', () => {
            const pimple = new Container();
            const arr = [];
            pimple.setShared('array', arr);
            pimple.set('array-c', arr);
            expect(pimple.get('array'), 'strictly the same object').to.equal(arr);
            expect(pimple.get('array-c'), 'a copy of the object').to.not.equal(arr);
            expect(pimple.get('array-c'), 'a copy of the object').to.eql(arr);
        })
    });

    describe('#labeling', () => {
        it('should call once for shared', () => {
            const pimple = new Container();
            let called = 0;
            pimple.defineLabel('push', (instance) => {
                called++;
                instance.push(called);
            });

            pimple.setShared('array', []);
            pimple.addLabel('array', 'push');

            expect(pimple.get('array'), 'has length of 2').to.have.members([1]);
            expect(pimple.get('array'), 'has length of 2').to.have.members([1]);
            expect(called).to.equal(1);
        });
        it('should call every time for simple', () => {
            const pimple = new Container();
            let called = 0;
            pimple.defineLabel('push', (instance) => {
                called++;
                instance.push(called);
            });

            pimple.set('array', []);
            pimple.addLabel('array', 'push');

            expect(pimple.get('array'), 'has length of 2').to.have.members([1]);
            expect(pimple.get('array'), 'has length of 2').to.have.members([2]);
            expect(called).to.equal(2);
        });

        it('multiple unique labels are available and order depends on service labeling', () => {
            const pimple = new Container();
            let called = 0;

            pimple.defineLabel('pushEverything', (instance) => {
                instance.push(42);
            });
            pimple.defineLabel('pushCount', (instance) => {
                called++;
                instance.push(called);
            });


            pimple.set('array', []);

            pimple.addLabel('array', 'pushCount');
            pimple.addLabel('array', 'pushEverything');
            pimple.addLabel('array', 'pushEverything');

            expect(pimple.get('array'), 'has length of 2').to.have.ordered.members([1, 42]);
            expect(pimple.get('array'), 'has length of 2').to.have.ordered.members([2, 42]);
            expect(called).to.equal(2);
        });

        it('inline declaration and set of label', () => {
            const pimple = new Container();

            pimple.set('arr', [], label('push', arr => arr.push(1)));

            expect(pimple.get('arr')).to.be.eql([1]);
        });
    });

    describe('#register', () => {
        it('should call a provided function to operate in with argument of di', () => {
            const pimple = new Container();

            pimple.register((pimpleInstance) => {
                pimpleInstance.set('test', 'ok')
            });

            expect(pimple.get('test')).to.equal('ok');
        })
    });

    describe('#tag', () => {
        it('should return tagged services Map', () => {
            const pimple = new Container({
                data1: 'data',
                data2: []
            });
            let tagged;

            pimple.tag('data1', 'wo', {name: 'wo', val: '42'});
            pimple.tag('data2', {name: 'wo', val: '*', opt: 42});

            tagged = pimple.getTag('wo');

            expect(tagged, 'keys should be correspond to tagged services').to.have.all.keys(['data1', 'data2']);
            expect(Array.from(tagged.values())).to.be.eql([
                [
                    {name: 'wo'}, //normalize string to a plain tag
                    {name: 'wo', val: '42'}
                ],
                [
                    {name: 'wo', val: '*', opt: 42}
                ]
            ]);
        });

        it('main purpose of tagged labels', () => {
            const pimple = new Container({
                custom1: [1, 2, 3],
                custom2: [4, 5]
            });

            pimple.setShared('target', []);

            pimple
                .tag('custom1', 'concat')
                .tag('custom1', {name: 'concat', value: 42}) //special secondary case with option pass
                .tag('custom2', 'concat', 'concat'); //this one will have 2 tags. so will be concatenated twice

            //labeling mainArray service with compiler
            pimple.addLabel('target', 'concatLabel');

            //define compiler
            pimple.defineLabel('concatLabel', (service, di) => {
                di.overTags('concat', (taggedService, tag) => {
                    if (tag.value) { //the special case
                        service.push(tag.value);
                    } else {
                        service.push(...di.get(taggedService));
                    }
                });
            });

            expect(pimple.get('target')).to.be.eql([1, 2, 3, 42, 4, 5, 4, 5]);
            expect(pimple.get('target'), 'no additional concat for shared')
                .to.be.eql([1, 2, 3, 42, 4, 5, 4, 5]);
        });
    });

    describe('#overTags', () => {
        it('ordering by specific field', () => {
            const pimple = new Container;
            const sortedASC = [];
            const sortedDESC = [];
            pimple.set('a', 'A');
            pimple.set('b', 'B');
            pimple.set('c', 'C');
            pimple.tag('a', {name: 't', order: 30});
            pimple.tag('b', {name: 't', order: 20});
            pimple.tag('c', {name: 't', order: 10});

            pimple.overTags('t', {field: 'order', order: -1}, (serviceId) => {
                sortedASC.push(pimple.get(serviceId))
            });

            pimple.overTags('t', ['order', 1], (serviceId) => {
                sortedDESC.push(pimple.get(serviceId))
            });

            expect(sortedASC).to.be.eql(['A', 'B', 'C']);
            expect(sortedDESC).to.be.eql(['C', 'B', 'A']);
        });

        it('ordering by specific field', () => {
            const pimple = new Container;
            const sortedPriorityRepeated = [];
            pimple.set('a', 'A');
            pimple.set('b', 'B');
            pimple.tag('a', {name: 't', priority: 1000});
            pimple.tag('a', {name: 't', priority: 20}); //duplicates leads to separate iteration
            pimple.tag('b', 't'); //zero treat
            pimple.tag('b', {name: 't', priority: 20000}); //see above

            pimple.overTags('t', ['priority', -1], (serviceId) => {
                sortedPriorityRepeated.push(pimple.get(serviceId))
            });

            expect(sortedPriorityRepeated).to.be.eql(['B', 'A', 'A', 'B']);
        })
    });

    describe('#id', () => {
        it('should specify id of service while compiling', () => {
            const pimple = new Container({
                myIdentifier: [1, 2, 3]
            });

            pimple.defineLabel('id-to-body', function (instance) {
                instance.push(this.id);
            });

            pimple.addLabel('myIdentifier', 'id-to-body');

            expect(pimple.getDefinition('myIdentifier').id).to.be.equal('myIdentifier');
            expect(pimple.get('myIdentifier'), 'definition is bounded to this on label cb')
                .to.be.eql([1, 2, 3, 'myIdentifier']);
        })
    });

    describe('#extend', () => {
        it('should pass service to extend callback to make changes for new', () => {

        })
    });

    describe('#protect', () => {
        it('should pass service to extend callback to make changes for new', () => {

        })
    })
});
