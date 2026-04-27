pipeline {
    agent any

    environment {
        STAGING_PROJECT = 'thoughtful-staging'
        PROD_PROJECT = 'thoughtful-prod'
        LOGS_GROUP_NAME = 'writing-study-irb-approved'
    }

    stages {
        stage('Build') {
            steps {
                echo 'Building the application...'
                sh '''
                    EXP_LOGS_GID=$(getent group ${LOGS_GROUP_NAME} | cut -d: -f3)
                    export EXP_LOGS_GID
                    bash scripts/ensure_log_dirs.sh \
                        /opt/thoughtful/logs \
                        /opt/thoughtful/experiment-logs \
                        /opt/thoughtful/staging-logs \
                        /opt/thoughtful/staging-experiment-logs
                    docker compose -f docker-compose.yml -f docker-compose-prod.yml build
                '''
            }
        }
        // stage('Test') {
        //     steps {
        //         echo 'Running tests...'
        //         sh 'docker-compose run backend pytest'
        //     }
        // }
        // stage('Lint') {
        //     steps {
        //         echo 'Running linters...'
        //         sh 'docker-compose run backend flake8 backend'
        //     }
        // }
        stage('Deploy Staging') {
            when {
                anyOf {
                    branch 'main'
                }
            }
            steps {
                echo 'Deploying staging from main...'
                withCredentials([
                    string(credentialsId: 'OpenAI-API-Key-Thoughtful', variable: 'OPENAI_API_KEY'),
                    string(credentialsId: 'Thoughtful-Study-Log-Secret', variable: 'LOG_SECRET'),
                    string(credentialsId: 'POSTHOG_SOURCEMAP_KEY', variable: 'POSTHOG_SOURCEMAP_KEY'),
                    string(credentialsId: 'POSTHOG_PROJECT_TOKEN', variable: 'POSTHOG_PROJECT_TOKEN')
                ]) {
                    sh '''
                        EXP_LOGS_GID=$(getent group ${LOGS_GROUP_NAME} | cut -d: -f3)
                        export EXP_LOGS_GID
                        bash scripts/ensure_log_dirs.sh \
                            /opt/thoughtful/staging-logs \
                            /opt/thoughtful/staging-experiment-logs
                        OPENAI_API_KEY=${OPENAI_API_KEY} \
                        LOG_SECRET=${LOG_SECRET} \
                        POSTHOG_SOURCEMAP_KEY=${POSTHOG_SOURCEMAP_KEY} \
                        POSTHOG_PROJECT_TOKEN=${POSTHOG_PROJECT_TOKEN} \
                        docker compose \
                        -p ${STAGING_PROJECT} \
                        -f docker-compose.yml \
                        -f docker-compose-staging.yml \
                        up -d --build
                    '''
                }
            }
        }

        stage('Deploy Production') {
            when {
                allOf {
                    buildingTag()
                    expression { env.TAG_NAME ==~ /^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/ }
                }
            }
            steps {
                echo "Deploying production from release tag ${env.TAG_NAME}..."
                withCredentials([
                    string(credentialsId: 'OpenAI-API-Key-Thoughtful', variable: 'OPENAI_API_KEY'),
                    string(credentialsId: 'Thoughtful-Study-Log-Secret', variable: 'LOG_SECRET'),
                    string(credentialsId: 'POSTHOG_SOURCEMAP_KEY', variable: 'POSTHOG_SOURCEMAP_KEY'),
                    string(credentialsId: 'POSTHOG_PROJECT_TOKEN', variable: 'POSTHOG_PROJECT_TOKEN')
                ]) {
                    sh '''
                        EXP_LOGS_GID=$(getent group ${LOGS_GROUP_NAME} | cut -d: -f3)
                        export EXP_LOGS_GID
                        bash scripts/ensure_log_dirs.sh \
                            /opt/thoughtful/logs \
                            /opt/thoughtful/experiment-logs
                        OPENAI_API_KEY=${OPENAI_API_KEY} \
                        LOG_SECRET=${LOG_SECRET} \
                        POSTHOG_SOURCEMAP_KEY=${POSTHOG_SOURCEMAP_KEY} \
                        POSTHOG_PROJECT_TOKEN=${POSTHOG_PROJECT_TOKEN} \
                        docker compose \
                        -p ${PROD_PROJECT} \
                        -f docker-compose.yml \
                        -f docker-compose-prod.yml \
                        up -d --build
                    '''
                }
            }
        }
    }
}