//
// install
// perform a new installation of the AB Runtime.
//
// options:
//  --developer   :  setup the environment for a developer
//
var async = require("async");
var fs = require("fs");
var path = require("path");
var shell = require("shelljs");
var utils = require("./utils/utils");
const { default: chalk } = require("chalk");
var Setup = require(path.join(__dirname, "setup.js"));
var TenantAdmin = require(path.join(
   __dirname,
   "tasks",
   "configTenantAdmin.js"
));

var Options = {}; // the running options for this command.

//
// Build the Install Command
//
var Command = new utils.Resource({
   command: "install",
   params: "--developer",
   descriptionShort: "perform a new installation of the AB Runtime.",
   descriptionLong: `
`,
});

module.exports = Command;

Command.help = function () {
   console.log(`

  usage: $ appbuilder install [name] [options]

  [name] : the name of the directory to install the AppBuilder Runtime into.

  [options] :
    --develop  : setup the installation for a programming environment
    --V1       : setup the v1 appbuilder environment
    --travisCI : indicate this is running in travisCI environment.
    --prod2021 : setup the 2021 production environment
    --verbose  : display more logs during install

    ${Setup.helpOptions}
    tenant administrator:
    --tenant.username [string] : the default tenant admin username
    --tenant.password [string] : the default tenant admin password
    --tenant.email    [string] : the default tenant admin email
    --tenant.url      [string] : the default tenant admin url

    --runtime [branch] : allow checking out another branch of our ab_runtime


  examples:

    $ appbuilder install ABv2
        - installs AppBuilder into directory ./ABv2

    $ appbuilder install Dev --develop
        - installs AppBuilder into directory ./Dev
        - installs all services locally

    $ appbuilder install sails --V1
        - installs AppBuilder v1 into directory ./sails

`);
};

Command.run = function (options) {
   return new Promise((resolve, reject) => {
      async.series(
         [
            // copy our passed in options to our Options
            (done) => {
               for (var o in options) {
                  Options[o] = options[o];
               }
               Options.name = options._.shift();

               // check for valid params:
               if (!Options.name) {
                  console.log("missing required param: [name]");
                  Command.help();
                  process.exit(1);
               }

               // FIX: make sure we catch mistyped --Develop
               Options.develop = Options.develop || Options.Develop;
               if (Options.verbose) utils.logFormatter.setVerbose();

               utils.unstringifyBools(Options);
               done();
            },
            checkV1,
            checkProd2021,
            checkDependencies,
            cloneRepo,
            installDependencies,
            runSetup,
            copyDBInit,
            initializeDB,
            runDbMigrations,
            removeTempDBInitFiles,
            configTenantAdmin,
            installDeveloperFiles,
            compileUI,
            downStack,
            devInstallEndMessage,
         ],
         (err) => {
            // now make sure we have popd() all remaining directories
            // we start by pushd() an additional one and then using
            // the returned list of entries as a basis for removing
            // all the remaining.
            var list = shell.pushd("-q", process.cwd());
            list.pop(); // we need to popd() until there is only 1
            // remove the rest:
            list.forEach(() => {
               shell.popd("-q");
            });

            // if there was an error that wasn't an ESKIP error:
            if (err && (!err.code || err.code != "ESKIP")) {
               reject(err);
               return;
            }
            resolve();
         }
      );
   });
};

/**
 * @function checkDependencies
 * verify the system has any required dependencies for generating ssl certs.
 * @param {function} done  node style callback(err)
 */
function checkDependencies(done) {
   // verify we have 'git'
   utils.checkDependencies(
      ["git", Options.platform === "podman" ? "podman" : "docker"],
      done
   );
}

/**
 * @function checkV1
 * check to see if they are requesting an install of the V1 AppBuilder environment.
 * if they are, pass control to the installV1 command and skip the rest of the steps.
 * @param {function} done  node style callback(err)
 */
function checkV1(done) {
   if (Options["V1"] || Options["v1"]) {
      try {
         Options._.unshift(Options.name);
         delete Options.name;

         var installV1 = require(path.join(__dirname, "installV1.js"));
         installV1
            .run(Options)
            .then(() => {
               var skipError = new Error("Just Skip this install");
               skipError.code = "ESKIP";
               done(skipError);
            })
            .catch(done);
      } catch (e) {
         console.error("Unable to find installV1.js install script.");
         done(e);
      }
   } else {
      done();
   }
}

/**
 * check to see if they are requesting an install of the 2021 production environment.
 * if they are, pass control to the prod2021 command and skip the rest of the steps.
 * @param {function} done  node style callback(err)
 */
function checkProd2021(done) {
   if (Options["prod2021"]) {
      try {
         Options._.unshift(Options.name);
         delete Options.name;

         var prod2021 = require(path.join(__dirname, "prod2021.js"));
         prod2021
            .run(Options)
            .then(() => {
               var skipError = new Error("Just Skip this install");
               skipError.code = "ESKIP";
               done(skipError);
            })
            .catch(done);
      } catch (e) {
         console.error("Unable to find prod2021.js install script.");
         done(e);
      }
   } else {
      done();
   }
}

/**
 * @function cloneRepo
 * clone the AB_runtime repo into the specified directory.
 */
async function cloneRepo() {
   console.log("... cloning repo");
   await utils.logFormatter.exec(
      `git clone https://github.com/roguisharcanetrickster/ab_runtime.git ${Options.name}`,
      { hideStderr: true, errColor: "gray" }
   );

   shell.pushd("-q", Options.name);

   // Allow installing using a branch or commit in ab_runtime --runtime [branch/commit]
   if (Options.runtime) {
      await utils.logFormatter.exec(
         `git fetch origin ${Options.runtime} && git checkout FETCH_HEAD`,
         { showAll: true }
      );
   }
}

/**
 * @function installDependencies
 * clone the AB_runtime repo into the specified directory.
 */
async function installDependencies() {
   console.log("... install dependencies");
   await utils.logFormatter.exec(`npm install --no-fund --no-audit`, {
      hideStderr: true,
      errColor: "gray",
   });
}

/**
 * @function runSetup
 * perform the "$ appbuilder setup" command.
 * @param {cb(err)} done
 */
function runSetup(done) {
   if (Options.develop) Options.nodeENV = "development";
   else Options.nodeENV = "production";

   Setup.run(Options)
      .then((opt) => {
         for (var o in opt) {
            if (!Options[o]) {
               Options[o] = opt[o];
            }
         }
         done();
      })
      .catch(done);
}

/**
 * @function copyDBInit
 * copy over the dbinit-compose.yml file
 * This is just temporary for the initial install step.
 * @param {cb(err)} done
 */
function copyDBInit(done) {
   const pathTemplate = path.join(
      utils.fileTemplatePath(),
      "_dbinit-compose.yml"
   );
   const contents = utils.fileRender(pathTemplate, Options);
   fs.writeFileSync("dbinit-compose.yml", contents);
   done();
}

/**
 * @function removeTempDBInitFiles
 * remove any of the temp files left from DB Init
 * @param {cb(err)} done
 */
function removeTempDBInitFiles(done) {
   shell.rm("dbinit-compose.yml");
   done();
}

/**
 * @function installDeveloperFiles
 * perform the developer/ setup
 */
async function installDeveloperFiles() {
   if (!Options.develop) return;
    if (!shell.which("tar")) {
        console.error("Warning! 'tar' is not installed. If install fails, please install it before retrying.");
    }

   console.log("... installing developer files (this will take awhile)");
   console.log("    ... download digiserve/ab-code-developer");
   await utils.logFormatter.exec(
      `docker image pull digiserve/ab-code-developer:master`
   );
   shell.exec(
      `docker run -v ${process.cwd()}:/app/dest digiserve/ab-code-developer:master`,
      { silent: true }
   );

   console.log("    ... untaring files into developer/");
   let bar;
   if (!Options.silent) {
      bar = utils.logFormatter.progressBar("    ");
      bar.start(100, 0, { filename: "/developer" });
   }
   const checkpoint = 46130;
   /**
    * checpoint for tar command, calulation:
    * `du -sk --apparent-size developer.tar.bz2 | cut -f 1` / 45
    * we can't simply divide by 100 because of the compression. divide by 45 seems
    * to give 100 checkpoints. Not all systems have du, so hard code this
    */
   await new Promise((resolve) => {
      const tarCmd = shell.exec(
         `tar -xjf developer.tar.bz2`,
         { silent: true },
         () => {
            if (bar) {
               bar.update(100);
               bar.stop();
            }
            resolve();
         }
      );
      if (bar) {
         tarCmd.stdout.on("data", () => bar.increment());
      }
   });

   console.log("    ... removing tar file");
   await utils.logFormatter.exec("rm developer.tar.bz2");
}

async function compileUI() {
   if (!Options.develop) return;

   console.log("... compile the web UI");
   shell.pushd("-q", path.join(process.cwd(), "developer", "ab_platform_web"));
   await utils.logFormatter.exec(
      `node node_modules/webpack-cli/bin/cli.js -c webpack.dev.js`
   );
   shell.popd("-q");

   console.log("... compile ABDesigner UI");
   shell.pushd(
      "-q",
      path.join(process.cwd(), "developer", "plugins", "ABDesigner")
   );
   await utils.logFormatter.exec(
      `node node_modules/webpack-cli/bin/cli.js -c webpack.dev.js`
   );
   shell.popd("-q");
   return;
}

function configTenantAdmin(done) {
   if (Options.__dbSkipped) {
      return done();
   }

   console.log("... configuring default Tenant details");
   var options = JSON.parse(JSON.stringify(Options.tenant || {}));
   options.stack = Options.stack;
   options.dbPassword = Options.dbPassword;
   options.platform = Options.platform;
   TenantAdmin.run(options)
      .then(() => {
         done();
      })
      .catch(done);
}

function initializeDB(done) {
   console.log("... initialize the DB tables");
   const options = { ...Options };
   // Keep this stack running for DB migrations
   options.keepRunning = true;
   utils
      .dbInit(options, "dbinit-compose.yml")
      .then((skipped) => {
         Options.__dbSkipped = skipped;
         done();
      })
      .catch((err) => {
         done(err);
      });
   // shell.exec(path.join(process.cwd(), "DBInit.js"));
   // done();
}

/**
 * run our db migrations from migration manager
 */
async function runDbMigrations() {
   if (Options.__dbSkipped) return;

   console.log("... run db migration scripts");
   const params = {
      stack: Options.stack,
      keepRunning: true,
      platform: Options.platform,
   };
   await utils.runDbMigrations(params);
}

/**
 * @function downStack()
 * bring the stack back down to finish out our install
 */
function downStack(done) {
   console.log("... bringing down the Stack");
   const command =
      Options.platform === "podman"
         ? `podman compose down -f docker.compose.yml -p ${Options.stack}`
         : `docker stack rm ${Options.stack}`;
   shell.exec(command, { silent: true });
   done();
}

/** Display a help message for dev installs */
async function devInstallEndMessage() {
   if (!Options.develop) return;
   console.log(`\u2554${utils.logFormatter.line(42)}\u2557`);
   console.log(
      `\u2551  ${chalk.bgGreen.black(
         "   AppBuilder Dev Install Complete!   "
      )}  \u2551`
   );
   console.log(`\u2551${utils.logFormatter.adjustLength("", 42)}\u2551`);
   console.log(
      `\u2551${utils.logFormatter.adjustLength(
         " To get started, run these commands:",
         42
      )}\u2551`
   );
   console.log(`\u2551${utils.logFormatter.adjustLength("", 42)}\u2551`);
   console.log(
      `\u2551  ${chalk.bgWhite.cyan(" $")}${chalk.bgWhite.black(
         ` cd ${utils.logFormatter.adjustLength(Options.name, 27)}`
      )}       \u2551`
   );
   console.log(
      `\u2551  ${chalk.bgWhite.cyan(" $")}${chalk.bgWhite.black(
         `${utils.logFormatter.adjustLength(" ./UP.sh -d", 31)}`
      )}       \u2551`
   );
   console.log(`\u2551${utils.logFormatter.adjustLength("", 42)}\u2551`);
   console.log(
      `\u2551 Then visit ${chalk.cyan(
         utils.logFormatter.adjustLength(`http://localhost:${Options.port}`, 29)
      )} \u2551`
   );
   console.log(`\u2551${utils.logFormatter.adjustLength("", 42)}\u2551`);
   console.log(
      `\u2551${utils.logFormatter.adjustLength(
         " To add our e2e test suites run:",
         42
      )}\u2551`
   );
   console.log(`\u2551${utils.logFormatter.adjustLength("", 42)}\u2551`);
   console.log(
      `\u2551  ${chalk.bgWhite.cyan(" $")}${chalk.bgWhite.black(
         utils.logFormatter.adjustLength(` appbuilder test add`, 31)
      )}       \u2551`
   );
   console.log(`\u2551${utils.logFormatter.adjustLength("", 42)}\u2551`);
   console.log(`\u255A${utils.logFormatter.line(42)}\u255D`);
}
