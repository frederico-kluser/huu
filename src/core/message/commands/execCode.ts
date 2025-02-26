import TypeChannelObjectFunction from "../../../types/channelOBjectFunction";
import CommunicationChannel from "../../../types/communicationChannel";

const execCode: TypeChannelObjectFunction = {
    [CommunicationChannel.BACKGROUND]: () => { },
    [CommunicationChannel.CONTENT]: () => { },
    [CommunicationChannel.POPUP]: () => { },
};

export default execCode;