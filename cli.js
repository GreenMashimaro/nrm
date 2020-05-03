#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const program = require('commander');
const npm = require('npm');
// 读取配置$path_home/.nrmrc时使用， https://github.com/npm/ini#readme
const ini = require('ini');
const extend = require('extend');
const open = require('open');
const async = require('async');
const request = require('request');
const only = require('only');
const humps = require('humps'); // 下划线到驼峰式大小写转换器

// 默认源文件
const registries = require('./registries.json');
const PKG = require('./package.json');
/**
 * process.env 当前Shell的环境变量，以我的电脑为例: /Users/carl
 * path.join(process.env.HOME, '.nrmrc')即为: /Users/carl/.nrmrc
 */
const NRMRC = path.join(process.env.HOME, '.nrmrc');
const NPMRC = path.join(process.env.HOME, '.npmrc');

const FIELD_AUTH = '_auth';
const FIELD_ALWAYS_AUTH = 'always-auth';
const FIELD_IS_CURRENT = 'is-current';
const FIELD_REPOSITORY = 'repository';
const FIELD_REGISTRY = 'registry';
const FIELD_HOME = 'home';
const FIELD_EMAIL = 'email';
const FIELD_SHOW_URL = "show-url"
const REGISTRY_ATTRS = [FIELD_REGISTRY, FIELD_HOME, FIELD_AUTH, FIELD_ALWAYS_AUTH];
const IGNORED_ATTRS = [FIELD_IS_CURRENT, FIELD_REPOSITORY]; // 忽略的属性，即这些值是nrm内部使用的，使用者设置自定义值时，不能使用这些属性值


program
    .version(PKG.version);

// 命令行 nrm ls => 调用 onList方法
program
    .command('ls')
    .description('List all the registries') // nrm --help对应的提示
    .action(onList);

// 命令行 nrm current => 调用 showCurrent方法
program
    .command('current')
    .option('-u, --show-url', 'Show the registry URL instead of the name')
    .description('Show current registry name or URL') // nrm --help对应的提示
    .action(showCurrent);

// 命令行 nrm use npm => 调用 onUse方法
program
    .command('use <registry>')
    .description('Change registry to registry')
    .action(onUse);

// 命令行 nrm add <registry> <url> [home] => 调用 onAdd方法
program
    .command('add <registry> <url> [home]')
    .description('Add one custom registry')
    .action(onAdd);

// 命令行 nrm login <registryName> [value] => 调用 onLogin方法
program
    .command('login <registryName> [value]')
    .option('-a, --always-auth', 'Set is always auth')
    .option('-u, --username <username>', 'Your user name for this registry')
    .option('-p, --password <password>', 'Your password for this registry')
    .option('-e, --email <email>', 'Your email for this registry')
    .description('Set authorize information for a custom registry with a base64 encoded string or username and pasword')
    .action(onLogin);

// 命令行 nrm set-hosted-repo <registry> <value> => 调用 onSetRepository方法
program
    .command('set-hosted-repo <registry> <value>')
    .description('Set hosted npm repository for a custom registry to publish packages')
    .action(onSetRepository);

// 命令行 nrm set-scope <scopeName> <value> => 调用 onSetScope方法
// 参考官方文档：https://docs.npmjs.com/misc/scope#associating-a-scope-with-a-registry
program
    .command('set-scope <scopeName> <value>')
    .description('Associating a scope with a registry')
    .action(onSetScope);

// 命令行 nrm del-scope <scopeName> => 调用 onDelScope方法
program
    .command('del-scope <scopeName>')
    .description('remove a scope')
    .action(onDelScope);

// 命令行 nrm set <registryName> => 调用 onSet方法
program
    .command('set <registryName>')
    .option('-a,--attr <attr>', 'set custorm registry attribute')
    .option('-v,--value <value>', 'set custorm registry value')
    .description('Set custom registry attribute')
    .action(onSet);
// 命令行 nrm rename <registryName> <newName> => 调用 onRename方法
program
    .command('rename <registryName> <newName>')
    .description('Set custom registry name')
    .action(onRename);

// 命令行 nrm del <registry> => 调用 onDel方法
program
    .command('del <registry>')
    .description('Delete one custom registry')
    .action(onDel);

// 命令行 nrm home <registry> [browser] => 调用 onHomeonHome方法
program
    .command('home <registry> [browser]')
    .description('Open the homepage of registry with optional browser')
    .action(onHome);

// 命令行 nrm publish [<tarball>|<folder>] => 调用 onPublish方法
program
    .command('publish [<tarball>|<folder>]')
    .option('-t, --tag [tag]', 'Add tag')
    .option('-a, --access <public|restricted>', 'Set access')
    .option('-o, --otp [otpcode]', 'Set otpcode')
    .option('-dr, --dry-run', 'Set is dry run')
    .description('Publish package to current registry if current registry is a custom registry.\n if you\'re not using custom registry, this command will run npm publish directly')
    .action(onPublish);

// 命令行 nrm test [registry] => 调用 onTest方法
program
    .command('test [registry]')
    .description('Show response time for specific or all registries')
    .action(onTest);

// 命令行 nrm help
program
    .command('help', { isDefault: true })
    .description('Print this help \n if you want to clear the NRM configuration when uninstall you can execute "npm uninstall nrm -g -C or npm uninstall nrm -g --clean"')
    .action(function () {
        program.outputHelp();
    });

program
    .parse(process.argv);


if (process.argv.length === 2) {
    program.outputHelp();
}

/*//////////////// cmd methods /////////////////*/

function onList () {
    getCurrentRegistry(function (cur) {
        var info = [''];
        /** 获取npm源列表，以一个对象的形式，如：
            cnpm: { home: 'http://cnpmjs.org', registry: 'http://r.cnpmjs.org/' },
            taobao: {
                home: 'https://npm.taobao.org',
                registry: 'https://registry.npm.taobao.org/'
            },
         */
        var allRegistries = getAllRegistry();
        const keys = Object.keys(allRegistries);
        // 取出key最大的长度，然后加3
        const len = Math.max(...keys.map(key => key.length)) + 3;

        Object.keys(allRegistries).forEach(function (key) {
            /**
             * 获取每一个key对应的配置，比如taobao源对应的value值
             * allRegistries['taobao']为 { home: 'https://npm.taobao.org', registry: 'https://registry.npm.taobao.org/' }
             */
            var item = allRegistries[key];
            var prefix = equalsIgnoreCase(item.registry, cur) && item[FIELD_IS_CURRENT] ? '* ' : '  ';
            info.push(prefix + key + line(key, len) + item.registry);
        });

        info.push('');
        // 显示在Terminal上的信息
        /**
        info = [
            '',
            '  npm -------- https://registry.npmjs.org/',
            '  yarn ------- https://registry.yarnpkg.com/',
            '  tencent ---- https://mirrors.cloud.tencent.com/npm/',
            '  cnpm ------- http://r.cnpmjs.org/',
            '  taobao ----- https://registry.npm.taobao.org/',
            '  nj --------- https://registry.nodejitsu.com/',
            '  npmMirror -- https://skimdb.npmjs.com/registry/',
            '  edunpm ----- http://registry.enpmjs.org/',
            ''
            ]
         */
        printMsg(info);
    });
}

/**
 * 显示当前选中的源
 *  执行 nrm current显示源的名称
 *  执行 nrm current显示源名称对应的源的url
 * @param {Object} cmd 请查看https://github.com/tj/commander.js/blob/HEAD/Readme_zh-CN.md#%e9%80%89%e9%a1%b9
 */
function showCurrent (cmd) {
    // getCurrentRegistry获取当前使用npm源，当使用npm源时，cur值为https://registry.npmjs.org/
    getCurrentRegistry(function (cur) {
        var allRegistries = getAllRegistry();
        Object.keys(allRegistries).forEach(function (key) {
            var item = allRegistries[key];
            // .nrmrc中对应的源有is-current=true，且两个npm源的url忽略大小写相等
            if (item[FIELD_IS_CURRENT] && equalsIgnoreCase(item.registry, cur)) {
                /*
                    humps.camelize(FIELD_SHOW_URL, { separator: '-' })等于同'show-url'转为'showUrl'
                    当执行命令nrm current -u 或 nrm current --show-url时，cmd.showUrl的值为true
                */
                const showUrl = cmd[humps.camelize(FIELD_SHOW_URL, { separator: '-' })];
                printMsg([showUrl ? item.registry : key]);
                return;
            }
        });
    });
}

/**
 * 通过npm api执行npm命令，参考文档：https://docs.npmjs.com/cli/config
 *  npm config set <key> <value> [-g|--global]
 *  npm config delete <key>
 * @param {Array} attrArray 设置的属性值
 * @param {Object} registry 对应单个源的配置
 * @param {Number} index 用于遍历attrArray
 */
function config (attrArray, registry, index = 0) {
    return new Promise((resolve, reject) => {
        const attr = attrArray[index];
        const command = registry.hasOwnProperty(attr) ? ['set', attr, String(registry[attr])] : ['delete', attr];
        npm.load(function (err) {
            if (err) return reject(err);
            /* 执行命令
              npm config set <key> <value> [-g|--global]
              npm config delete <key>
            */ 
            npm.commands.config(command, function (err, data) {
                return err ? reject(err) : resolve(index + 1);
            });
        });
    }).then(next => {
        // next是index+1后的值
        if (next < attrArray.length) {
            // 这里是一个递归，在then再调用config(attrArray, registry, next)是为了确宝一个命令已经执行完成
            return config(attrArray, registry, next);
        } else {
            return Promise.resolve();
        }
    });
}

// 使用哪个npm源
function onUse (name) {
    // 获取npm源列表，以对象形式返回
    var allRegistries = getAllRegistry();
    // allRegistries对象下是否有key为name的值
    if (allRegistries.hasOwnProperty(name)) {
        getCurrentRegistry(function (cur) {
            let currentRegistry, item;
            for (let key of Object.keys(allRegistries)) {
                item = allRegistries[key];
                if (item[FIELD_IS_CURRENT] && equalsIgnoreCase(item.registry, cur)) {
                    currentRegistry = item;
                    break;
                }
            }
            var registry = allRegistries[name];
            let attrs = [].concat(REGISTRY_ATTRS).concat();
            for (let attr in Object.assign({}, currentRegistry, registry)) {
                if (!REGISTRY_ATTRS.includes(attr) && !IGNORED_ATTRS.includes(attr)) {
                    attrs.push(attr);
                }
            }

            /**
             * 1.调用npm执行npm config命令，设置npm源，设置npm源，
             * 2.将当前选中的源写入到.nrmrc配置中，且添加is-current=true字段
             */
            config(attrs, registry).then(() => {
                console.log('                        ');
                const newR = npm.config.get(FIELD_REGISTRY);
                var customRegistries = getCustomRegistry();
                // 删除列表中“当前选中”的npm标识
                Object.keys(customRegistries).forEach(key => {
                    delete customRegistries[key][FIELD_IS_CURRENT];
                });
                if (customRegistries.hasOwnProperty(name) && (name in registries || customRegistries[name].registry === registry.registry)) {
                    registry[FIELD_IS_CURRENT] = true;
                    customRegistries[name] = registry;
                }
                // 写入新的配置到.nrmrc文件，已经选中的npm源会有一个is-current=true的字段
                setCustomRegistry(customRegistries);
                printMsg(['', '   Registry has been set to: ' + newR, '']);
            }).catch(err => {
                exit(err);
            });
        });
    } else {
        printMsg(['', '   Not find registry: ' + name, '']);
    }
}

function onDel (name) {
    var customRegistries = getCustomRegistry();
    if (!customRegistries.hasOwnProperty(name)) return;
    getCurrentRegistry(function (cur) {
        // 如果删除的源在.nrmrc中存在，则使用默认源为npm
        if (equalsIgnoreCase(customRegistries[name].registry, cur)) {
            onUse('npm');
        }
        // 删除customRegistries的源对应的key
        delete customRegistries[name];
        // 将customRegistries写入到.nrmrc中
        setCustomRegistry(customRegistries, function (err) {
            if (err) return exit(err);
            printMsg(['', '    delete registry ' + name + ' success', '']);
        });
    });
}

function onAdd (name, url, home) {
    var customRegistries = getCustomRegistry();
    // 已经存在的源的名称时，直接返回，不执行操作
    if (customRegistries.hasOwnProperty(name)) return;
    var config = customRegistries[name] = {};
    // 如果url没有以 / 结尾，则追回 / 到url上，如 url为http://www.baidu.com，追加后的结果为 http://www.baidu.com/
    if (url[url.length - 1] !== '/') url += '/'; // ensure url end with /
    config.registry = url;
    // home为源的官方网站，如npm源的主页为：https://www.npmjs.org
    if (home) {
        config.home = home;
    }
    // 写入新的内容到.nrmrc
    setCustomRegistry(customRegistries, function (err) {
        if (err) return exit(err);
        printMsg(['', '    add registry ' + name + ' success', '']);
    });
}

// 比如私有化npm源有权限设置的情况，需要先登录
//   调用 npm set _auth，参考文章：https://stackoverflow.com/questions/35043155/how-should-i-set-auth-in-npmrc-when-using-a-nexus-https-npm-registry-proxy
//   调用npm set config always-auth§: 参考文章：https://docs.npmjs.com/misc/config#always-auth
function onLogin (registryName, value, cmd) {
    console.log('zzn cmd.alwaysAuth:', cmd.alwaysAuth)
    const customRegistries = getCustomRegistry();
    // .nrmrc是否有对应名称的源
    if (!customRegistries.hasOwnProperty(registryName)) return;
    const registry = customRegistries[registryName];
    let attrs = [FIELD_AUTH];
    if (value) {
        // 执行nrm login taobao [value]的情况
        registry[FIELD_AUTH] = value;
    } else if (cmd.username && cmd.password) {
        // 执行nrm login --username=carl --password=carl的情况
        registry[FIELD_AUTH] = Buffer.from(`${cmd.username}:${cmd.password}`).toString('base64');
    } else {
        return exit(new Error('your username & password or auth value is required'));
    }
    // 执行nrm login --always-auth的情况为true
    // 等同于 if (cmd.alwaysAuth)
    if (cmd[humps.camelize(FIELD_ALWAYS_AUTH, { separator: '-' })]) {
        registry[FIELD_ALWAYS_AUTH] = true;
        attrs.push(FIELD_ALWAYS_AUTH);
    }
    if (cmd.email) {
        registry.email = cmd.email;
        attrs.push(FIELD_EMAIL);
    }
    // 执行npm命令
    new Promise(resolve => {
        registry[FIELD_IS_CURRENT] ? resolve(config(attrs, registry)) : resolve();
    }).then(() => {
        // npm命令执行成功，将新配置写入到.nrmrc
        customRegistries[registryName] = registry;
        setCustomRegistry(customRegistries, function (err) {
            if (err) return exit(err);
            printMsg(['', '    set authorize info to registry ' + registryName + ' success', '']);
        });
    }).catch(exit);
}

// 功能：执行npm set repository，但我在官方文档找不对有对这的这个npm命令
function onSetRepository (registry, value) {
    var customRegistries = getCustomRegistry();
    if (!customRegistries.hasOwnProperty(registry)) return;
    var config = customRegistries[registry];
    config[FIELD_REPOSITORY] = value;
    new Promise(resolve => {
        config[FIELD_IS_CURRENT] ? resolve(config([FIELD_REPOSITORY], config)) : resolve();
    }).then(() => {
        setCustomRegistry(customRegistries, function (err) {
            if (err) return exit(err);
            printMsg(['', `    set ${FIELD_REPOSITORY} to registry [${registry}] success`, '']);
        });
    }).catch(exit);
}

// 功能：.npmrc写入 ${scopeName}:registry={value的值}
// 比如执行：nrm set-scope test1 http://test.com，写入.npmrc的内容为 test1:registry=http://test.com
function onSetScope (scopeName, value) {
    const scopeRegistryKey = `${scopeName}:registry`
    config([scopeRegistryKey], { [scopeRegistryKey]: value }).then(function () {
        printMsg(['', `    set [ ${scopeRegistryKey}=${value} ] success`, '']);
    }).catch(exit)
}

// 执行npm config delete `${scopeName}:registry`
function onDelScope (scopeName) {
    const npmrc = getNPMInfo();
    const scopeRegistryKey = `${scopeName}:registry`
    npmrc[scopeRegistryKey] && config([scopeRegistryKey], {}).then(function () {
        printMsg(['', `    delete [ ${scopeRegistryKey} ] success`, '']);
    }).catch(exit)
}

function onSet (registryName, cmd) {
    if (!registryName || !cmd.attr || cmd.value === undefined) return;
    if (IGNORED_ATTRS.includes(cmd.attr)) return;
    var customRegistries = getCustomRegistry();
    if (!customRegistries.hasOwnProperty(registryName)) return;
    const registry = customRegistries[registryName];
    registry[cmd.attr] = cmd.value;
    new Promise(resolve => {
        // 如果写入的新属性操作的是当前选中的源，则执行npm config ${cmd.attr} ${cmd.value}，否则直接写入到.nrmrc文件中
        registry[FIELD_IS_CURRENT] ? resolve(config([cmd.attr], registry)) : resolve();
    }).then(() => {
        customRegistries[registryName] = registry;
        // 写入新的配置到.nrmrc
        setCustomRegistry(customRegistries, function (err) {
            if (err) return exit(err);
            printMsg(['', `    set registry ${registryName} [${cmd.attr}=${cmd.value}] success`, '']);
        });
    }).catch(exit);
}

// 功能：修改.nrmrc源名称
function onRename (registryName, newName) {
    if (!newName || registryName === newName) return;
    let customRegistries = getCustomRegistry();
    if (!customRegistries.hasOwnProperty(registryName)) {
        console.log('Only custom registries can be modified');
        return;
    }
    if (registries[newName] || customRegistries[newName]) {
        console.log('The registry contains this new name');
        return;
    }
    customRegistries[newName] = JSON.parse(JSON.stringify(customRegistries[registryName]));
    delete customRegistries[registryName];
    // 写入新的配置到.nrmrc
    setCustomRegistry(customRegistries, function (err) {
        if (err) return exit(err);
        printMsg(['', `    rename ${registryName} to ${newName} success`, '']);
    });
}
// 打开对应源的官方页面，eg：nrm home npm，则会打开浏览器https://www.npmjs.com/
function onHome (name, browser) {
    var allRegistries = getAllRegistry();
    var home = allRegistries[name] && allRegistries[name].home;
    console.log('zzn home:', home)
    if (home) {
        var args = [home];
        if (browser) args.push(browser);
        // 打开浏览器
        open.apply(null, args);
    }
}

// 执行npm publish
function onPublish (tarballOrFolder, cmd) {
    getCurrentRegistry(registry => {
        const customRegistries = getCustomRegistry();
        let currentRegistry;
        // find current using custom registry
        Object.keys(customRegistries).forEach(function (key) {
            const item = customRegistries[key];
            if (item[FIELD_IS_CURRENT] && equalsIgnoreCase(item.registry, registry)) {
                currentRegistry = item;
                currentRegistry.name = key;
            }
        });
        const attrs = [FIELD_REGISTRY];
        let command = '> npm publish';
        const optionData = {};
        // cmd.options命令行执行时填写的选项
        cmd.options.forEach(option => {
            const opt = option.long.substring(2);
            const optionValue = cmd[opt];
            if (optionValue) {
                optionData[opt] = cmd[opt];
                attrs.push(opt);
            }
        });
        new Promise((resolve, reject) => {
            if (currentRegistry) {
                if (currentRegistry[FIELD_REPOSITORY]) {
                    printMsg(['',
                        '   current registry is a custom registry, publish to custom repository.',
                        ''
                    ]);
                    optionData.registry = currentRegistry[FIELD_REPOSITORY];
                    Object.keys(optionData).forEach((key) => {
                        command += ` --${key} ${optionData[key]}`;
                    });
                    printMsg([command]);
                    resolve(config(attrs, optionData));
                } else {
                    reject(new Error(`   current using registry [${currentRegistry.name}] has no ${FIELD_REPOSITORY} field, can't execute publish.`));
                }
            } else {
                printMsg(['',
                    '   current using registry is not a custom registry, will publish to npm official repository.',
                    ''
                ]);
                // 使用npm源
                optionData.registry = registries.npm.registry;
                // find current using registry
                Object.keys(registries).forEach(function (key) {
                    const item = registries[key];
                    if (item.registry === registry) {
                        currentRegistry = item;
                        currentRegistry.name = key;
                    }
                });
                printMsg([command]);
                resolve(config(attrs, optionData));
            }
        }).then(() => {
            const callback = (err) => {
                config(attrs, currentRegistry).then(() => {
                    err && exit(err);
                    printMsg(['', `   published to registry ${currentRegistry[FIELD_REPOSITORY]} successfully.`, '']);
                }).catch(exit);
            };
            try {
                // 执行npm publish
                tarballOrFolder ? npm.publish(tarballOrFolder, callback) : npm.publish(callback);
            } catch (e) {
                callback(err);
            }
        }).catch(err => {
            printErr(err);
        });
    });
}

/*
  调用 ${url}/pedding测试请求是否成功
  如测试yarn源：https://registry.yarnpkg.com/pedding
*/
function onTest (registry) {
    var allRegistries = getAllRegistry();

    var toTest;

    if (registry) {
        // 不在列表中的源，直接返回
        if (!allRegistries.hasOwnProperty(registry)) {
            return;
        }
        toTest = only(allRegistries, registry);
    } else {
        // 执行nrm test测试所有源
        toTest = allRegistries;
    }

    async.map(Object.keys(toTest), function (name, cbk) {
        var registry = toTest[name];
        var start = +new Date();
        request(registry.registry + 'pedding', function (error) {
            cbk(null, {
                name: name,
                registry: registry.registry,
                time: (+new Date() - start),
                error: error ? true : false
            });
        });
    }, function (err, results) {
        getCurrentRegistry(function (cur) {
            var msg = [''];
            results.forEach(function (result) {
                var prefix = result.registry === cur ? '* ' : '  ';
                var suffix = result.error ? 'Fetch Error' : result.time + 'ms';
                msg.push(prefix + result.name + line(result.name, 8) + suffix);
            });
            msg.push('');
            printMsg(msg);
        });
    });
}



/*//////////////// helper methods /////////////////*/

/*
 * get current registry
 */
function getCurrentRegistry (cbk) {
    // 执行npm.config.get前得先执行npm.load
    npm.load(function (err, conf) {
        if (err) return exit(err);
        // 等同于执行npm config get registry
        cbk(npm.config.get(FIELD_REGISTRY));
    });
}

// 获取-从$path_home/.nrmrc文件里，读取自定义列表
function getCustomRegistry () {
    /* .nrmrc配置文件的内容为
      [test1]
      registry=http://test1.com/
    */
    // getINIInfo(NRMRC)的值为：{ test1: { registry: 'http://test1.com/' } }
    return getINIInfo(NRMRC)
}

/**
 * 写入新的配置到.nrmrc
 * @param {*} config 写入的config内容
 * @param {*} cbk 执行fs.writeFile写入结果的回调
 */
function setCustomRegistry (config, cbk) {
    for (let name in config) {
        // 如果配置的名称和默认配置的名称相同的配置，则不写入
        if (name in registries) {
            delete config[name].registry;
            delete config[name].home;
        }
    }
    /**
     * 通过ini转换成配置文件的格式，如config为{ test1: { registry: 'http://test1.com/' } }
     * 生成的配置文件为
        [test1]
        registry=http://test1.com/
     */
    fs.writeFile(NRMRC, ini.stringify(config), cbk)
}

// 获取源列表：  默认列表 + 自定义列表
function getAllRegistry () {
    // 获取-自定义列表
    const custom = getCustomRegistry();
    // 先将 自定义列表 和 默认列表 合并
    const all = extend({}, registries, custom);
    for (let name in registries) {
        if (name in custom) {
            // 如果自定义列表配置的名称和默认列表配置的名称相同，则以默认列表的配置为准
            // 比如添加了nrm add taobao http://taoba.com
            // 则执行nrm ls查看的结果为： taobao https://registry.npm.taobao.org/
            all[name] = extend({}, custom[name], registries[name]);
        }
    }
    return all;
}

// 打印信息-Error
function printErr (err) {
    console.error('an error occured: ' + err);
}

// 打印信息-info
function printMsg (infos) {
    infos.forEach(function (info) {
        console.log(info);
    });
}

// 获取$path_home/.npmrc的配置
function getNPMInfo () {
    /* .npmrc配置文件的内容为
      registry=https://registry.npmjs.org/
      home=https://www.npmjs.org
    */
    // getINIInfo(NPMRC)的值为：{ registry: 'https://registry.npmjs.org/', home: 'https://www.npmjs.org' }
    return getINIInfo(NPMRC)
}


function getINIInfo (path) {
    // 通过ini读取.npmrc或.nrmrc内容
    return fs.existsSync(path) ? ini.parse(fs.readFileSync(path, 'utf-8')) : {};
}

/*
 * 退出程序
 * print message & exit
 */
function exit (err) {
    printErr(err);
    process.exit(1);
}

function line (str, len) {
    // eg: new Array(3).join('-')结果为：‘--’
    var line = new Array(Math.max(1, len - str.length)).join('-');
    return ' ' + line + ' ';
}

/**
 * compare ignore case
 * 忽略大小写，eg: 传入aa和Aa，返回结果为true
 * @param {string} str1
 * @param {string} str2
 */
function equalsIgnoreCase (str1, str2) {
    if (str1 && str2) {
        return str1.toLowerCase() === str2.toLowerCase();
    } else {
        return !str1 && !str2;
    }
}

// 删除.nrmrc内的内容，使用默认配置里边（./registries.json）的npm源
function cleanRegistry () {
    setCustomRegistry('', function (err) {
        if (err) exit(err);
        onUse('npm')
    })
}

module.exports = {
    cleanRegistry,
    errExit: exit
}
