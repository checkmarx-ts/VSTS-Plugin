import * as url from 'url';
import * as request from 'superagent';
import {Logger} from "./logger";

interface RequestOptions {
    baseUrlOverride?: string;
    singlePostData?: object;
    multipartPostData?: {
        fields: { [fieldName: string]: any },

        // Key: attachment field name.
        // Value: paths of the file to attach.
        attachments: { [fieldName: string]: string }
    };
    retry: boolean;
}

/**
 * Implements low-level API request logic.
 */
export class HttpClient {
    accessToken: string = '';

    private username = '';
    private password = '';

    constructor(private readonly baseUrl: string, private readonly log: Logger) {
    }

    login(username: string, password: string) {
        this.log.info('Logging into the Checkmarx service.');
        this.username = username;
        this.password = password;
        return this.loginWithStoredCredentials();
    }

    getRequest(relativePath: string, baseUrlOverride?: string): Promise<any> {
        return this.sendRequest(relativePath, {baseUrlOverride, retry: true});
    }

    postRequest(relativePath: string, data: object): Promise<any> {
        return this.sendRequest(relativePath, {singlePostData: data, retry: true});
    }

    postMultipartRequest(relativePath: string,
                         fields: { [fieldName: string]: any },
                         attachments: { [fieldName: string]: string }) {
        return this.sendRequest(relativePath, {
            multipartPostData: {
                fields,
                attachments
            },
            retry: true
        });
    }

    private sendRequest(relativePath: string, options: RequestOptions): Promise<any> {
        const effectiveBaseUrl = options.baseUrlOverride || this.baseUrl;
        const fullUrl = url.resolve(effectiveBaseUrl, relativePath);

        const method = options.singlePostData || options.multipartPostData ? 'post' : 'get';

        this.log.debug(`Sending ${method.toUpperCase()} request to ${fullUrl}`);

        let result = request[method](fullUrl)
            .auth(this.accessToken, {type: 'bearer'})
            .accept('json');

        result = HttpClient.includePostData(result, options);

        return result.then(
            (response: request.Response) => {
                return response.body;
            },
            async (err: any) => {
                const canRetry = options.retry && err && err.response && err.response.unauthorized;
                if (canRetry) {
                    this.log.warning('Access token expired, requesting a new token');
                    await this.loginWithStoredCredentials();

                    const optionsClone = Object.assign({}, options);
                    // Avoid infinite recursion.
                    optionsClone.retry = false;
                    return this.sendRequest(relativePath, optionsClone);
                } else {
                    this.log.warning(`${method.toUpperCase()} request failed to ${fullUrl}`);
                    return Promise.reject(err);
                }
            }
        );
    }

    private static includePostData(result: request.SuperAgentRequest, options: RequestOptions) {
        if (options.singlePostData) {
            result = result.send(options.singlePostData);
        } else if (options.multipartPostData) {
            const {fields, attachments} = options.multipartPostData;
            result = result.field(fields);
            for (const prop in attachments) {
                result = result.attach(prop, attachments[prop]);
            }
        }
        return result;
    }

    private loginWithStoredCredentials() {
        const fullUrl = url.resolve(this.baseUrl, 'auth/identity/connect/token');
        return request
            .post(fullUrl)
            .type('form')
            .send({
                userName: this.username,
                password: this.password,
                grant_type: 'password',
                scope: 'sast_rest_api offline_access',
                client_id: 'resource_owner_client',
                client_secret: '014DF517-39D1-4453-B7B3-9930C563627C'
            })
            .then(
                (response: request.Response) => {
                    this.accessToken = response.body.access_token;
                },
                (err: any) => {
                    const status = err && err.response ? (err.response as request.Response).status : 'n/a';
                    const message = err && err.message ? err.message : 'n/a';
                    this.log.error(`POST request failed to ${fullUrl}. HTTP status: ${status}, message: ${message}`);
                    throw Error('Login failed');
                }
            );
    }
}
